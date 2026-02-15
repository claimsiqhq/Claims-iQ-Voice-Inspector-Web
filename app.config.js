export default {
  expo: {
    ...require("./app.json").expo,
    owner: "claimsiq",
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:5000",
      eas: {
        projectId: "e70b8d1c-02fc-429d-b1c1-476bba398da3",
      },
    },
  },
};
