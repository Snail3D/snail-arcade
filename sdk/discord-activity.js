import { DiscordSDK } from "@discord/embedded-app-sdk";

// SupaBot application ID
const CLIENT_ID = "1476403022832734339";

const discordSdk = new DiscordSDK(CLIENT_ID);

async function initDiscordActivity() {
  try {
    await discordSdk.ready();
    console.log("[discord-activity] SDK ready");
    return discordSdk;
  } catch (e) {
    console.log("[discord-activity] Not running inside Discord, standalone mode");
    return null;
  }
}

// Auto-init and expose globally
window.__discordSdk = null;
window.__discordReady = initDiscordActivity().then(sdk => {
  window.__discordSdk = sdk;
  return sdk;
});
