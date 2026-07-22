import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: (env) => ({
    name: "Agent Provider",
    description:
      "Use your own LLM provider with trusted, tool-enabled web applications.",
    permissions: ["storage", "activeTab", "tabs"],
    host_permissions: [
      "https://api.openai.com/*",
      "https://api.anthropic.com/*",
      "https://generativelanguage.googleapis.com/*",
      "https://***REMOVED***/*",
    ],
    optional_host_permissions: ["https://*/*"],
    action: {
      default_title: "Agent Provider",
    },
    ...(env.browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "agent-provider@amaroolabs.com",
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
