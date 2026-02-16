export default {
  expo: {
    ...require("./app.json").expo,
    owner: "claimsiq",
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://hjxruhvnswtleqpuhkgb.supabase.co",
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
      eas: {
        projectId: "e70b8d1c-02fc-429d-b1c1-476bba398da3",
      },
    },
  },
};
