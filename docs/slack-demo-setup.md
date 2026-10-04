# New Slack demo workspace

Status: manifest prepared; workspace, installation/token and channels are not yet provisioned.
Browser automation is unavailable in the current session and no Slack token is configured.

1. Create a workspace named **Grovekeeper Demo** at https://slack.com/create using an
   email you can verify. Select the free plan when offered.
2. At https://api.slack.com/apps choose **Create New App**, **From a manifest**, and
   select that workspace. Paste [slack-app-manifest.json](slack-app-manifest.json).
3. Install the app to the workspace. Copy its **Bot User OAuth Token** into the
   ignored `api/local.settings.json`, under `Values.SLACK_BOT_TOKEN`. Start from
   `api/local.settings.example.json` if needed; preserve existing configuration.
   Do not put the token in chat, a VITE variable, source control or this document.
4. Create public channels **contoso**, **fabrikam**, **northwind**. Add the Grovekeeper
   app to each channel. The app has read scopes only; channel creation is done by
   the workspace owner, not by adding management scopes to the runtime bot.
5. In each channel's details, copy its channel ID. In Grovekeeper's Add to grove
   panel, select the corresponding real account and enter that ID for Slack Sync.
   Use real API mode (`VITE_USE_MOCKS=false`) and configured Functions/OpenAI/storage.
6. Post these clearly fictional demo messages as a human member (bot messages are skipped):

| Channel | Demo message |
| --- | --- |
| contoso | I will send the payroll integration checklist by 2026-10-09. |
| fabrikam | There is a risk that missing sandbox credentials will delay our pilot. |
| northwind | We need bilingual payroll statements for Quebec employees. |

Sync each channel, inspect its source quote, then sync again and confirm no duplicate
seeds. Reload the real account dashboard and confirm stored seeds are still present.
Record successful verification only after running it; mock tests do not prove live sync.

Slack references: [workspace creation](https://slack.com/help/articles/206845317-Create-a-Slack-workspace),
[manifest fields](https://docs.slack.dev/reference/app-manifest/),
[OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/).
