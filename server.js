const express = require('express');
const bodyParser = require('body-parser');
const app = express();

// Enable body parsing for JSON data
app.use(bodyParser.json());

// User profiles for Alice and Bob
const users = {
  alice: {
    preferredUsername: 'alice',
    inbox: 'https://grassrootsactivitypub2.onrender.com/inbox/alice',
    publicKey: {
      id: 'https://grassrootsactivitypub2.onrender.com/user/alice#main-key',
      owner: 'https://grassrootsactivitypub2.onrender.com/user/alice',
      publicKeyPem: 'YOUR_PUBLIC_KEY_FOR_ALICE',
    },
  },
  bob: {
    preferredUsername: 'bob',
    inbox: 'https://grassrootsactivitypub2.onrender.com/inbox/bob',
    publicKey: {
      id: 'https://grassrootsactivitypub2.onrender.com/user/bob#main-key',
      owner: 'https://grassrootsactivitypub2.onrender.com/user/bob',
      publicKeyPem: 'YOUR_PUBLIC_KEY_FOR_BOB',
    },
  },
};

// Serve Alice's profile
app.get('/user/alice', (req, res) => {
  res.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: 'https://grassrootsactivitypub2.onrender.com/user/alice',
    type: 'Person',
    preferredUsername: users.alice.preferredUsername,
    inbox: users.alice.inbox,
    publicKey: users.alice.publicKey,
  });
});

// Serve Bob's profile
app.get('/user/bob', (req, res) => {
  res.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: 'https://grassrootsactivitypub2.onrender.com/user/bob',
    type: 'Person',
    preferredUsername: users.bob.preferredUsername,
    inbox: users.bob.inbox,
    publicKey: users.bob.publicKey,
  });
});

// WebFinger for Alice
app.get('/.well-known/webfinger', (req, res) => {
  const { resource } = req.query;
  if (resource === 'acct:alice@grassrootsactivitypub2.onrender.com') {
    res.json({
      subject: 'acct:alice@grassrootsactivitypub2.onrender.com',
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: 'https://grassrootsactivitypub2.onrender.com/user/alice',
        },
      ],
    });
  } else if (resource === 'acct:bob@grassrootsactivitypub2.onrender.com') {
    res.json({
      subject: 'acct:bob@grassrootsactivitypub2.onrender.com',
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: 'https://grassrootsactivitypub2.onrender.com/user/bob',
        },
      ],
    });
  } else {
    res.status(404).send('Not Found');
  }
});

// Inbox endpoint for receiving messages (activity objects)
app.post('/inbox/:username', (req, res) => {
  const username = req.params.username;
  const activity = req.body;

  if (username !== 'alice' && username !== 'bob') {
    return res.status(404).send('User not found');
  }

  console.log(`Received activity for ${username}:`, activity);
  res.json({ status: 'Message received' });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`ActivityPub server is running at http://localhost:${port}`);
});
