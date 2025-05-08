// Fixed and working version of server.js with inbox/outbox entries and correct order of operations

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const port = process.env.PORT || 3000;
const base = 'https://grassrootsactivitypub2.onrender.com';

app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use('/user', express.static(path.join(__dirname, 'user')));

const followers = {};
const activities = {};

function createHTTPSignature({ privateKey, keyId, headers }) {
  const signer = crypto.createSign('RSA-SHA256');
  const signatureHeaders = [
    `(request-target): post /inbox/${headers.recipient}`,
    `host: grassrootsactivitypub2.onrender.com`,
    `date: ${headers.date}`,
    `digest: ${headers.digest}`
  ].join('\n');
  signer.update(signatureHeaders);
  signer.end();
  return `keyId=\"${keyId}\",algorithm=\"rsa-sha256\",headers=\"(request-target) host date digest\",signature=\"${signer.sign(privateKey, 'base64')}\"`;
}

function encryptMessage(publicKeyPem, message) {
  return crypto.publicEncrypt({
    key: publicKeyPem,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, Buffer.from(message, 'utf8')).toString('base64');
}

function decryptMessage(privateKeyPem, encryptedMessage) {
  return crypto.privateDecrypt({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, Buffer.from(encryptedMessage, 'base64')).toString('utf8');
}

app.post('/create-user/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  const userDir = path.join(__dirname, 'user', username);
  const inboxDir = path.join(__dirname, 'inbox', username);
  const outboxDir = path.join(__dirname, 'outbox', username);

  if (fs.existsSync(userDir)) return res.status(400).json({ error: `User '${username}' already exists.` });

  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(outboxDir, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(path.join(userDir, 'public-key.pem'), publicKey);
  fs.writeFileSync(path.join(userDir, 'private-key.pem'), privateKey);

  const profile = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${base}/user/${username}`,
    type: 'Person',
    preferredUsername: username,
    inbox: `${base}/inbox/${username}`,
    outbox: `${base}/outbox/${username}`,
    followers: `${base}/user/${username}/followers`,
    following: `${base}/user/${username}/following`,
    publicKey: {
      id: `${base}/user/${username}#main-key`,
      owner: `${base}/user/${username}`,
      publicKeyPem: publicKey
    }
  };

  fs.writeFileSync(path.join(userDir, 'index.json'), JSON.stringify(profile, null, 2));
  followers[username] = [];
  activities[username] = [];
  res.status(201).json({ status: `User '${username}' created successfully` });
});

app.post('/send-message', async (req, res) => {
  const { sender, recipient, content } = req.body;
  if (!sender || !recipient || !content) return res.status(400).json({ error: 'Missing sender, recipient, or content' });

  const timestamp = Date.now();
  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Create',
    actor: `${base}/user/${sender.toLowerCase()}`,
    published: new Date(timestamp).toISOString(),
    object: {
      type: 'Note',
      content: content,
      to: [`${base}/user/${recipient.toLowerCase()}`]
    }
  };

  const outboxDir = path.join(__dirname, 'outbox', sender.toLowerCase());
  if (!fs.existsSync(outboxDir)) fs.mkdirSync(outboxDir, { recursive: true });

  const outboxEntry = { activity, sentAt: new Date(timestamp).toISOString() };
  fs.writeFileSync(path.join(outboxDir, `${timestamp}.json`), JSON.stringify(outboxEntry, null, 2));
  if (!activities[sender.toLowerCase()]) activities[sender.toLowerCase()] = [];
  activities[sender.toLowerCase()].push(activity);

  const recipientKeyPath = path.join(__dirname, 'user', recipient.toLowerCase(), 'public-key.pem');
  if (!fs.existsSync(recipientKeyPath)) return res.status(404).json({ error: `Public key for ${recipient} not found` });
  const recipientPublicKey = fs.readFileSync(recipientKeyPath, 'utf8');

  const encryptedMessage = encryptMessage(recipientPublicKey, content);
  const inboxDir = path.join(__dirname, 'inbox', recipient.toLowerCase());
  if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
  const inboxEntry = { encryptedMessage, from: sender.toLowerCase(), to: recipient.toLowerCase(), receivedAt: new Date(timestamp).toISOString() };
  fs.writeFileSync(path.join(inboxDir, `${timestamp}.json`), JSON.stringify(inboxEntry, null, 2));

  const inboxUrl = `${base}/inbox/${recipient.toLowerCase()}`;
  const date = new Date().toUTCString();
  const digest = `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(activity)).digest('base64')}`;
  const keyId = `${base}/user/${sender.toLowerCase()}#main-key`;
  const senderPrivKeyPath = path.join(__dirname, 'user', sender.toLowerCase(), 'private-key.pem');
  if (!fs.existsSync(senderPrivKeyPath)) return res.status(404).json({ error: `Private key for ${sender} not found` });
  const senderPrivateKey = fs.readFileSync(senderPrivKeyPath, 'utf8');

  const signatureHeader = createHTTPSignature({ privateKey: senderPrivateKey, keyId, headers: { recipient, date, digest } });
  const headers = {
    Host: 'grassrootsactivitypub2.onrender.com',
    Date: date,
    Digest: digest,
    'Content-Type': 'application/json',
    Signature: signatureHeader
  };

  try {
    const response = await fetch(inboxUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(activity)
    });

    if (response.ok) {
      res.status(200).json({ status: 'Message sent and encrypted successfully', sentAt: new Date(timestamp).toISOString(), plaintext: content });
    } else {
      const errorText = await response.text();
      res.status(response.status).json({ error: 'Failed to deliver message', details: errorText });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to send signed message', details: err.message });
  }
});

app.get('/decrypt/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  const inboxDir = path.join(__dirname, 'inbox', username);
  const privateKeyPath = path.join(__dirname, 'user', username, 'private-key.pem');
  if (!fs.existsSync(inboxDir) || !fs.existsSync(privateKeyPath)) return res.status(404).json({ error: 'Inbox or private key not found.' });

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const files = fs.readdirSync(inboxDir).sort();
  const decryptedMessages = files.map(filename => {
    const content = fs.readFileSync(path.join(inboxDir, filename));
    const { encryptedMessage } = JSON.parse(content);
    const decrypted = decryptMessage(privateKeyPem, encryptedMessage);
    return { filename, decrypted };
  });

  res.json(decryptedMessages);
});

app.get('/', (req, res) => res.send('✅ Grassroots ActivityPub server is running'));

app.listen(port, () => console.log(`✅ Express server running on port ${port}`));
