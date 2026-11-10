using System;
using System.Linq;
using System.Threading;
using System.IO;
class FakeTool {
    static int Main(string[] args) {
        if (args.Length == 0) return 2;
        string state=System.Reflection.Assembly.GetExecutingAssembly().Location+".state";
        if (args[0] == "attach") { File.WriteAllText(state,args[Array.IndexOf(args,"-b")+1]); Console.WriteLine("successfully attached to port 7"); return 0; }
        if (args[0] == "detach") { File.Delete(state); Console.WriteLine("port 7 is successfully detached"); return 0; }
        if (args[0] == "port") { if(File.Exists(state)) Console.WriteLine("Imported USB devices\n====================\nPort 07: device in use at Full Speed\n -> usbip://127.0.0.1:3240/"+File.ReadAllText(state)+"\n"); return 0; }
        if (args[0] == "-NoProfile") {
            Console.WriteLine(args.Contains("-Snapshot") ? "[]" : "{\"Status\":\"OK\",\"InstanceId\":\"USB-MOCK\"}");
            return 0;
        }
        if (args[0] == "traffic") {
            Thread.Sleep(150);
            Console.WriteLine("MOCK_USB_TRAFFIC_PASS");
            return 0;
        }
        if (args[0] == "-c") {
            string counter = Environment.GetEnvironmentVariable("WDA_FAKE_SWD_COUNTER");
            if (counter != null) {
                int round = File.Exists(counter) ? int.Parse(File.ReadAllText(counter)) + 1 : 1;
                File.WriteAllText(counter, round.ToString());
                if (round == 2) return 2;
            }
            for (int i=0;i<30;i++) {
                Console.WriteLine("WDA_SWD_SAMPLE "+i+" MOCK");
                Thread.Sleep(100);
            }
            Console.WriteLine("WDA_SWD_PASS");
            return 0;
        }
        return 2;
    }
}
