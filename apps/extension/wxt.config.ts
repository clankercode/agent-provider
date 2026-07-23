import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: (env) => ({
    name: "Agent Provider",
    description:
      "Use your own LLM provider with trusted, tool-enabled web applications.",
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: [
      "https://api.openai.com/*",
      "https://api.anthropic.com/*",
      "https://generativelanguage.googleapis.com/*",
      "https://openrouter.ai/*",
    ],
    optional_host_permissions: ["https://*/*"],
    action: {
      default_title: "Agent Provider",
    },
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      96: "icon/96.png",
      128: "icon/128.png",
    },
    ...(env.browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "agent-provider@xk.io",
              data_collection_permissions: {
                required: [
                  "authenticationInfo",
                  "personalCommunications",
                  "websiteContent",
                  "websiteActivity",
                ],
              },
            },
          },
        }
      : {}),
  }),
});
