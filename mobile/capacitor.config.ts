import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "cn.xjy.jewelry.mobile",
  appName: "鑫金源珠宝",
  webDir: "dist",
  server: { hostname: "localhost", androidScheme: "https" },
  android: { backgroundColor: "#fbfaf7" },
  ios: { contentInset: "automatic", backgroundColor: "#fbfaf7" },
};
export default config;
