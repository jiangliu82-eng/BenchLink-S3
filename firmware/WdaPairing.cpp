// USB-to-UART0 provisioning. No input echo, command history, or credential logging.
#include <string>
#include <mutex>
#include <cstring>
#include <cctype>
#include "driver/uart.h"
#if CONFIG_WDA_DEVBOARD_RGB
#include "driver/rmt_tx.h"
#include "esp_log.h"
#endif
#include "driver/uart_vfs.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_http_server.h"
#include "nvs.h"
#include "cJSON.h"
#include "mbedtls/md.h"
#include "lwip/sockets.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "WifiConfigManager.h"

namespace {
std::mutex guard;
std::string device_id, pair_key, lease_ip;
int64_t lease_until=0;
struct Challenge { std::string value, ip; int64_t until=0; } challenges[8];
unsigned challenge_index=0;
std::string field(const cJSON *j,const char *key) {const auto *v=cJSON_GetObjectItemCaseSensitive(j,key);return cJSON_IsString(v)?v->valuestring:"";}
bool hex(const std::string &s,size_t n){if(s.size()!=n)return false;for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true;}
std::string encode(const uint8_t *b,size_t n){static const char *h="0123456789abcdef";std::string s;for(size_t i=0;i<n;i++){s+=h[b[i]>>4];s+=h[b[i]&15];}return s;}
std::string random_hex(){uint8_t b[16];esp_fill_random(b,sizeof b);return encode(b,sizeof b);}
std::string hmac(const std::string &text){uint8_t key[32],out[32];for(int i=0;i<32;i++)key[i]=std::stoi(pair_key.substr(i*2,2),nullptr,16);
    if(mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,sizeof key,(const unsigned char*)text.data(),text.size(),out)!=0)return "";
    memset(key,0,sizeof key);return encode(out,sizeof out);}
bool equal(const std::string &a,const std::string &b){if(a.size()!=64||b.size()!=64)return false;unsigned diff=0;for(size_t i=0;i<64;i++)diff|=a[i]^b[i];return diff==0;}
std::string peer(int fd) {
    sockaddr_storage address{};
    socklen_t length = sizeof(address);
    if (getpeername(fd, reinterpret_cast<sockaddr*>(&address), &length) != 0) return "";
    in_addr ipv4{};
    if (address.ss_family == AF_INET) {
        ipv4 = reinterpret_cast<const sockaddr_in*>(&address)->sin_addr;
    } else if (address.ss_family == AF_INET6) {
        const auto& ipv6 = reinterpret_cast<const sockaddr_in6*>(&address)->sin6_addr;
        if (!IN6_IS_ADDR_V4MAPPED(&ipv6)) return "";
        memcpy(&ipv4, &ipv6.s6_addr[12], sizeof(ipv4));
    } else {
        return "";
    }
    char text[INET_ADDRSTRLEN];
    return inet_ntop(AF_INET, &ipv4, text, sizeof(text)) ? text : "";
}
void send_json_uart(cJSON *j){char *s=cJSON_PrintUnformatted(j);if(s){std::string frame="\nWDA1 "+std::string(s)+"\n";uart_write_bytes(UART_NUM_0,frame.data(),frame.size());free(s);}cJSON_Delete(j);}
void serial_request(const std::string &line){
    if(line.rfind("WDA1 ",0)!=0)return;
    cJSON *j=cJSON_Parse(line.c_str()+5);if(!j)return;
    const auto req=field(j,"requestId"),cmd=field(j,"command");
    if(!hex(req,24)||cJSON_GetNumberValue(cJSON_GetObjectItemCaseSensitive(j,"version"))!=1){cJSON_Delete(j);return;}
    cJSON *reply=cJSON_CreateObject();cJSON_AddNumberToObject(reply,"version",1);cJSON_AddStringToObject(reply,"requestId",req.c_str());cJSON_AddStringToObject(reply,"deviceId",device_id.c_str());
    std::string error;
    if(cmd=="identify") {
        std::lock_guard lock(guard);cJSON_AddBoolToObject(reply,"paired",!pair_key.empty());
    } else if(cmd=="provision") {
        const auto id=field(j,"deviceId"), key=field(j,"key"),ssid=field(j,"ssid"),password=field(j,"password");
        if(id!=device_id)error="wrong_device";
        else if(!hex(key,64)||ssid.empty()||ssid.size()>31||password.size()>63||(!password.empty()&&password.size()<8))error="invalid_request";
        else {
            bool persisted=false;
            if(WifiConfigManager::instance().apply_config(ssid,password,&persisted)!=ESP_OK)error="wifi_failed";
            else if(!persisted)error="storage_failed";
            else {
                nvs_handle_t handle;
                esp_err_t result=nvs_open("wda_pair",NVS_READWRITE,&handle);
                if(result==ESP_OK){result=nvs_set_str(handle,"key",key.c_str());if(result==ESP_OK)result=nvs_commit(handle);nvs_close(handle);}
                if(result!=ESP_OK)error="storage_failed";
                else {std::lock_guard lock(guard);pair_key=key;lease_ip.clear();lease_until=0;for(auto &c:challenges)c.until=0;}
            }
        }
    } else error="invalid_request";
    cJSON_AddBoolToObject(reply,"ok",error.empty());
    if(!error.empty())cJSON_AddStringToObject(reply,"error",error.c_str());
    cJSON_AddStringToObject(reply,"host",WifiConfigManager::instance().ip_str().c_str());
    cJSON_Delete(j);send_json_uart(reply);
}
void serial_task(void*){
    std::string line;bool overflow=false;uint8_t c;
    for(;;){if(uart_read_bytes(UART_NUM_0,&c,1,pdMS_TO_TICKS(1000))!=1)continue;
        if(c=='\n'){if(!overflow)serial_request(line);std::fill(line.begin(),line.end(),'\0');line.clear();overflow=false;}
        else if(c!='\r'){if(line.size()<1536&&!overflow)line+=(char)c;else overflow=true;}
    }
}
esp_err_t respond(httpd_req_t *r,cJSON *j){char *s=cJSON_PrintUnformatted(j);cJSON_Delete(j);if(!s)return ESP_ERR_NO_MEM;httpd_resp_set_type(r,"application/json");httpd_resp_set_hdr(r,"Cache-Control","no-store");auto result=httpd_resp_sendstr(r,s);free(s);return result;}
esp_err_t session_get(httpd_req_t *r){
    char query[96],nonce[40];if(httpd_req_get_url_query_str(r,query,sizeof query)!=ESP_OK||httpd_query_key_value(query,"nonce",nonce,sizeof nonce)!=ESP_OK||!hex(nonce,32))return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid nonce");
    const auto ip=peer(httpd_req_to_sockfd(r));std::lock_guard lock(guard);
    if(pair_key.empty()||ip.empty())return httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"USB pairing required");
    auto &c=challenges[challenge_index++%8];c={random_hex(),ip,esp_timer_get_time()+30000000};
    cJSON *j=cJSON_CreateObject();cJSON_AddStringToObject(j,"deviceId",device_id.c_str());cJSON_AddStringToObject(j,"challenge",c.value.c_str());
    cJSON_AddStringToObject(j,"proof",hmac("device\n"+device_id+"\n"+nonce+"\n"+c.value).c_str());return respond(r,j);
}
esp_err_t session_post(httpd_req_t *r){
    if(r->content_len<=0||r->content_len>256)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid frame");
    std::string body(r->content_len,'\0');size_t at=0;while(at<body.size()){int n=httpd_req_recv(r,body.data()+at,body.size()-at);if(n<=0)return ESP_FAIL;at+=n;}
    cJSON *j=cJSON_Parse(body.c_str());const auto value=field(j,"challenge"),proof=field(j,"proof");cJSON_Delete(j);
    const auto ip=peer(httpd_req_to_sockfd(r));std::lock_guard lock(guard);bool allowed=false;
    if(!pair_key.empty())for(auto &c:challenges)if(c.value==value&&c.ip==ip&&c.until>esp_timer_get_time()){
        c.until=0;allowed=equal(proof,hmac("client\n"+device_id+"\n"+value));break;}
    if(!allowed)return httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"Pairing proof required");
    lease_ip=ip;lease_until=esp_timer_get_time()+120000000;
    j=cJSON_CreateObject();cJSON_AddStringToObject(j,"proof",hmac("ready\n"+device_id+"\n"+value).c_str());return respond(r,j);
}
void discovery_task(void*){
    int fd=socket(AF_INET,SOCK_DGRAM,0);if(fd<0){vTaskDelete(nullptr);return;}
    sockaddr_in local{};local.sin_family=AF_INET;local.sin_port=htons(7211);local.sin_addr.s_addr=htonl(INADDR_ANY);
    if(bind(fd,(sockaddr*)&local,sizeof local)!=0){close(fd);vTaskDelete(nullptr);return;}
    for(;;){char buf[256];sockaddr_in remote{};socklen_t len=sizeof remote;int n=recvfrom(fd,buf,sizeof(buf)-1,0,(sockaddr*)&remote,&len);if(n<=0)continue;buf[n]=0;
        cJSON *j=cJSON_Parse(buf);const auto type=field(j,"type"),id=field(j,"deviceId"),nonce=field(j,"nonce");cJSON_Delete(j);
        std::lock_guard lock(guard);if(type!="wda-discover"||id!=device_id||!hex(nonce,32)||pair_key.empty())continue;
        j=cJSON_CreateObject();cJSON_AddStringToObject(j,"deviceId",device_id.c_str());cJSON_AddStringToObject(j,"nonce",nonce.c_str());cJSON_AddStringToObject(j,"proof",hmac("discover\n"+device_id+"\n"+nonce).c_str());
        char *text=cJSON_PrintUnformatted(j);cJSON_Delete(j);if(text){sendto(fd,text,strlen(text),0,(sockaddr*)&remote,len);free(text);}
    }
}
#if CONFIG_WDA_DEVBOARD_RGB
void status_pixel_task(void*) {
    rmt_tx_channel_config_t config{};
    config.gpio_num = GPIO_NUM_48;
    config.clk_src = RMT_CLK_SRC_DEFAULT;
    config.resolution_hz = 10000000;
    config.mem_block_symbols = 64;
    config.trans_queue_depth = 1;
    rmt_channel_handle_t channel = nullptr;
    rmt_encoder_handle_t encoder = nullptr;
    rmt_copy_encoder_config_t copy{};
    esp_err_t err = rmt_new_tx_channel(&config, &channel);
    if (err == ESP_OK) err = rmt_new_copy_encoder(&copy, &encoder);
    if (err == ESP_OK) err = rmt_enable(channel);
    uint32_t previous = UINT32_MAX;
    bool blink = true;
    while (err == ESP_OK) {
        const bool wifi = WifiConfigManager::instance().is_connected();
        bool authenticated;
        {
            std::lock_guard lock(guard);
            if (!wifi) lease_until = 0;
            authenticated = lease_until > esp_timer_get_time();
        }
        // WS2812 wire order is green, red, blue. Keep the single pixel dim.
        const uint32_t color = authenticated ? 0x100000 : wifi ? 0x081000 : blink ? 0x000010 : 0;
        if (color != previous) {
            rmt_symbol_word_t symbols[25]{};
            for (unsigned i = 0; i < 24; ++i) {
                const bool one = color & (1U << (23 - i));
                symbols[i].level0 = 1;
                symbols[i].duration0 = one ? 8 : 4;
                symbols[i].duration1 = one ? 5 : 9;
            }
            symbols[24].duration0 = 1500;
            symbols[24].duration1 = 1500;
            rmt_transmit_config_t tx{};
            err = rmt_transmit(channel, encoder, symbols, sizeof(symbols), &tx);
            if (err == ESP_OK) err = rmt_tx_wait_all_done(channel, -1);
            previous = color;
        }
        blink = !blink;
        vTaskDelay(pdMS_TO_TICKS(500));
    }
    ESP_LOGE("wda-rgb", "Status pixel unavailable: %s", esp_err_to_name(err));
    if (channel) rmt_disable(channel);
    if (encoder) rmt_del_encoder(encoder);
    if (channel) rmt_del_channel(channel);
    vTaskDelete(nullptr);
}
#endif
}
extern "C" bool wda_pairing_peer_allowed(const char *ip){std::lock_guard lock(guard);return ip&&lease_ip==ip&&lease_until>esp_timer_get_time();}
extern "C" bool wda_pairing_socket_allowed(int fd){const auto ip=peer(fd);return wda_pairing_peer_allowed(ip.c_str());}
extern "C" void wda_pairing_start(){
    uint8_t mac[6];ESP_ERROR_CHECK(esp_read_mac(mac,ESP_MAC_WIFI_STA));device_id="wda-"+encode(mac,6);
    nvs_handle_t handle;if(nvs_open("wda_pair",NVS_READONLY,&handle)==ESP_OK){char value[65];size_t len=sizeof value;if(nvs_get_str(handle,"key",value,&len)==ESP_OK&&hex(value,64))pair_key=value;nvs_close(handle);}
    uart_config_t cfg{};cfg.baud_rate=115200;cfg.data_bits=UART_DATA_8_BITS;cfg.parity=UART_PARITY_DISABLE;cfg.stop_bits=UART_STOP_BITS_1;cfg.flow_ctrl=UART_HW_FLOWCTRL_DISABLE;cfg.source_clk=UART_SCLK_DEFAULT;
    ESP_ERROR_CHECK(uart_param_config(UART_NUM_0,&cfg));
    ESP_ERROR_CHECK(uart_set_pin(UART_NUM_0,43,44,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE));
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0,4096,0,0,nullptr,0));
    // Share the driver's TX mutex with system logs; a log must not split a JSON frame.
    uart_vfs_dev_use_driver(UART_NUM_0);
    configASSERT(xTaskCreate(serial_task,"wda-provision",8192,nullptr,4,nullptr)==pdPASS);
    configASSERT(xTaskCreate(discovery_task,"wda-discovery",4096,nullptr,3,nullptr)==pdPASS);
#if CONFIG_WDA_DEVBOARD_RGB
    xTaskCreate(status_pixel_task,"wda-rgb",3072,nullptr,2,nullptr);
#endif
}
extern "C" esp_err_t wda_register_pairing(httpd_handle_t server){
    httpd_uri_t get{};get.uri="/api/wda/session";get.method=HTTP_GET;get.handler=session_get;
    httpd_uri_t post{};post.uri=get.uri;post.method=HTTP_POST;post.handler=session_post;
    esp_err_t e=httpd_register_uri_handler(server,&get);return e==ESP_OK?httpd_register_uri_handler(server,&post):e;
}
