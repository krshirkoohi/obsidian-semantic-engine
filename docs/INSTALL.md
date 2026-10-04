# Install in Obsidian

Your deployment owner gives you a server URL and **device sync token** through a private channel. The separate owner connection password is for ChatGPT. Each person needs their own private vault and deployment.

## Desktop

1. Download `semantic-engine-0.1.0.zip` from [releases](https://github.com/krshirkoohi/obsidian-semantic-engine/releases).
2. Extract it into `.obsidian/plugins/` inside your vault. The result must be `.obsidian/plugins/semantic-engine/main.js`, next to `manifest.json` and `styles.css`.
3. Enable community plugins in Obsidian, reload the app and enable **Semantic Engine**.
4. Open **Settings → Semantic Engine**. Enter the server URL and device sync token.
5. Review the upload notice and exclusions, then enable sync.
6. Run **Semantic Engine: Show sync status** and resolve any conflicts.

You can also install the release with BRAT: add `krshirkoohi/obsidian-semantic-engine` and select version `0.1.0`. This project is not claimed to be approved in Obsidian's Community directory.

## iPhone, iPad and Android

Use BRAT on the device, or copy the plugin directory with the file tools available for the vault. Create a local vault and enter the same server URL and device token. Another sync service is not required.

Use the same vault name across devices for Obsidian deep links. The deployment's `VAULT_NAME` controls those links. Keep Obsidian open until the first sync finishes. Reopen it to receive later changes: mobile operating systems can suspend background apps.

## First sync

Local-only notes upload. Remote-only notes download. Identical notes establish a baseline. Different notes at the same path create a conflict: your local note stays in place, and the remote copy appears under **Semantic Engine Conflicts**.

The default server excludes `Private/` and `Templates/`, hidden folders, conflict copies and non-Markdown data. Decide exclusions before the first upload. Excluding a previously uploaded note does not erase Git history.

## Device acceptance check

Create a harmless note on device A. Sync and confirm it arrives unchanged on B. Edit on B and check A. Edit the same note differently on both and confirm a conflict without loss of either copy. Test a folder rename and a deletion. These checks remain necessary because automated tests cannot reproduce every native Obsidian and operating-system behaviour.
