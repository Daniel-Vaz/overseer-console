# Google Drive link

Optional, and the same as the [Dropbox link](dropbox.md) in what it does: saves carried between devices, and games
and mods loaded from your own cloud on any of them. The console has no Google app of its own: every player creates
one in their own Google account, with access to the console's own files only, and links the console to it.

Why Google Drive: a free Google account holds up to 15 GB, where a free Dropbox holds 2 GB. A game is about 550 MB;
the mods the console knows are 0.4 to 3 GB each as they are downloaded, and both games with all seven come to about
11 GB. Google's room is shared with Gmail and Google Photos, and Drive's trash counts until it is emptied. In some
regions Google gives new accounts 5 GB until a phone number is added to them.

The console links to one cloud at a time. To switch from Dropbox, fetch the saves you want from there, then unlink it.

## Setting up

Once, at a computer. It takes about ten minutes.

1. Open the [Google Cloud console](https://console.cloud.google.com/), signed in to the Google account whose Drive you
   want to use, and **create a project**. Any name will do, and no billing account is needed.
2. In that project, **enable the Google Drive API**:
   [APIs & Services, Library, Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com),
   **Enable**.
3. Open **Google Auth Platform** and choose **Get started**: any app name, your email for support and contact,
   Audience **External**. Agree to Google's policy and create it.
4. Under **Audience**, choose **Publish app** and confirm. An app left in *Testing* has its links ended by Google after
   seven days. The console asks for `drive.file` alone, which Google does not need to review.
5. Under **Clients**, create a client of the application type **TVs and Limited Input devices**, with any name. Copy
   its **Client ID** and **Client secret** straight away: Google shows the secret only then. If it is lost, open the
   client and add a new secret.
6. In the console, open **Terminal settings**, **Cloud link**, **Google Drive**. Enter the Client ID and the Client
   secret and choose **Get a code**. Then **Open Google to allow the link**: at google.com/device enter the code,
   choose your account, and allow the console. The console notices by itself and says whose Drive it is linked to.

Step 6 is needed once in every browser you play in. Steps 1 to 5 are not: the same client serves all of them, so keep
the Client ID and secret somewhere you can copy them from on your phone or tablet.

Linking is Google's sign-in for devices without a browser of their own (OAuth 2.0 for TV and limited-input devices).
The console shows a code, you enter it at Google, on this device or any other, and the console receives a lasting link.
No address of the console is registered with Google, so one client works wherever the console is opened from.

> [!IMPORTANT]
> The link asks for **`drive.file`** and nothing more: Google lets the console see and change the files it made in
> your Drive, and nothing else there. The link is a token kept in this site's browser storage, with the client's ID
> and secret, until you unlink. The secret is not a password: Google asks for it with every link, but a client of this
> kind runs where nothing stays secret, and Google treats it so.

## What it does

- **Saves.** *Save archives* offers *Upload to Google Drive* and *Fetch from Google Drive*. Nothing moves by itself. A
  save only ever replaces an older one, and what a fetch replaces goes into the slot's history. In the Drive a slot is
  one zip, `Overseer Console/Saves/<game>/SLOTnn.zip`: the archive the console exports, so it unpacks into a desktop
  install. Erasing a save that was uploaded puts its copy in Drive's trash.
- **Games and mods.** Google lets the console see only what it put in your Drive itself: a file you put in its folder
  with Google Drive's own website or app stays out of its sight, even in the right place. So games and mods go in
  through the console. Under Cloud link choose **Put in Google Drive**, then a game's folder or a zip of it, or a mod's
  folder or the zip it is downloaded as. A folder is packed into one zip on the way. Keep the tab open until it is all
  there: a game takes as long as uploading it to Google Drive's website would. Then, on any device linked to the Drive,
  a game's deck has *Load holodisk from Google Drive*, and the Mod library has *Load a mod*, *From Google Drive*.
- **Where.** The console makes a folder called **Overseer Console** at the top of My Drive. You can rename it or move
  it: the console finds it again. Games go at its top (the games folder), mods in `Mods` inside the games folder, saves
  in `Saves`. The games and saves folders can be changed on the Google Drive link screen.

## Unlinking

On the Google Drive link screen, **Unlink**:

- **Yes, unlink this browser** forgets the link here. Other browsers you linked stay linked, and nothing in your Drive
  changes. Do this on a computer that is not yours.
- **End access in every browser** has Google end the console's access, everywhere at once. By Google's rules that also
  takes the files the console put in your Drive out of its sight, possibly for good, even once you link again. The
  files themselves stay in your Drive. Removing the project under
  [Third-party apps and services](https://myaccount.google.com/connections) in your Google Account does the same.

## When it does not work

| What you see | What to do |
| --- | --- |
| *That client is not of the kind the console needs* | Create a client of the type **TVs and Limited Input devices** (step 5), and use its ID and secret. |
| *Google does not know that client ID* | Copy it again from the client's page in Google Cloud. |
| *Google did not accept that client secret* | Copy it again, or add a new secret on the client's page. The code you have still counts. |
| *The Google Drive API is not switched on* | Step 2. Wait a minute after enabling it, then get a new code. |
| Google's page says the app is in testing, or *Access blocked* | Step 4: publish the app. Or add your account under Audience, Test users; links then end after seven days. |
| *The code ran out* | A code works for half an hour. Get a new one. |
| *Your Google Drive is full* | Its room is shared with Gmail and Google Photos, and the trash counts. Make room, or empty the trash. |
| *No MASTER.DAT ... of what the console can see there* | The game was put in the Drive some other way. Put it in with **Put in Google Drive**. |
| *Google no longer accepts this link* | It was ended from Google's side, or not used for six months. Link again (step 6). |
