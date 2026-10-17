# Dropbox link

Optional. The console has no Dropbox app of its own: every player creates one in their own account, with
access to a single folder, and links the console to it.

## Linking

1. In the [Dropbox App Console](https://www.dropbox.com/developers/apps) choose **Create app**, **Scoped
   access**, **App folder**, and any name.
2. On the app's **Permissions** tab tick `files.metadata.read`, `files.content.read` and
   `files.content.write`, and press **Submit**.
3. In the console open **Terminal settings**, **Dropbox link**. Enter the **App key** from the app's Settings
   tab, open Dropbox from there, allow the app, and paste the code it shows.

Linking is the OAuth code flow with PKCE. There is no app secret and no redirect address; the app key is
not a secret.

> [!IMPORTANT]
> Create the app with **App folder** access, never Full Dropbox. The link is a token kept in this site's
> browser storage until *Unlink*, which also has Dropbox cancel it. With App folder access the token reaches
> the app's folder and nothing else.

## What it does

- **Saves.** *Save archives* offers *Upload to Dropbox* and *Fetch from Dropbox*. Nothing moves by itself. A
  save only ever replaces an older one, and what a fetch replaces goes into the slot's history. In Dropbox a
  slot is one zip, `Apps/<app>/Saves/<game>/SLOTnn.zip`: the archive the console exports, so it unpacks
  into a desktop install.
- **Games.** Put the folder a game is installed in anywhere inside `Apps/<app>/`, using Dropbox's own app
  or website, and choose *Load holodisk from Dropbox* on the game's deck. The console only reads there.
  This is the way to get a game, music included, onto a phone.
- **Mods.** Put each mod in the `Mods` folder inside the games folder (`Apps/<app>/Mods` unless you changed the
  games folder), as the zip it is downloaded as or as its folder, and choose *From Dropbox* under *Load a mod* in
  the Mod library: it lists what is there. A zip is best: a folder is thousands of small downloads. A game is never
  looked for in the `Mods` folder.

Both folders can be changed on the Dropbox link screen.
