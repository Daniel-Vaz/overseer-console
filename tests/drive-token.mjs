// An access token for tests/unit/drive.live.test.ts, got the way the console gets one: Google's sign-in for
// devices. Takes the ID and secret of your own client (of the type "TVs and Limited Input devices"):
//
//   node tests/drive-token.mjs "<client id>" "<client secret>"
//
// It prints a code to enter at google.com/device, waits until you have allowed it, and prints the token. The token
// reaches the files that client's links made in your Drive (the drive.file scope) and lasts an hour.

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: node tests/drive-token.mjs "<client id>" "<client secret>"');
  process.exit(2);
}

const post = async (url, fields) => {
  const response = await fetch(url, { method: 'POST', body: new URLSearchParams(fields) });
  return response.json();
};

const code = await post('https://oauth2.googleapis.com/device/code', { client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file' });
if (!code.device_code) {
  console.error('Google refused:', code);
  process.exit(1);
}
console.error(`Open ${code.verification_url}, enter ${code.user_code}, and allow the client.`);

let interval = Number(code.interval) || 5;
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  const tokens = await post('https://oauth2.googleapis.com/token', {
    client_id: clientId,
    client_secret: clientSecret,
    device_code: code.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (tokens.access_token) {
    console.log(tokens.access_token);
    break;
  }
  if (tokens.error === 'slow_down') interval += 5;
  else if (tokens.error !== 'authorization_pending') {
    console.error('Google refused:', tokens);
    process.exit(1);
  }
}
