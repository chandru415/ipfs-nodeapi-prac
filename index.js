import express from "express";

import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { unixfs } from "@helia/unixfs";
import { bootstrap } from "@libp2p/bootstrap";
import { tcp } from "@libp2p/tcp";
import { MemoryBlockstore } from "blockstore-core";
import { MemoryDatastore } from "datastore-core";
import { createHelia } from "helia";
import { createLibp2p } from "libp2p";
import { identifyService } from "libp2p/identify";

// dotenv.config();

// create app
const app = express();
const port = process.env.PORT || 9632;

// create two helia nodes
let node1;
let node2;

// Create a file system
let fs;
let fs2;

app.use(express.json());

// listen
app.listen(port, () => {
  console.log(`node server is running on port: ${port}`);
});

// GET
app.get("/", (req, res) => {
  res.send(`Hello IPFS!`);
});

// CreateNodes

app.get("/createnodes", async (req, res) => {
  const nodes = await createLocalNodes();
  res.send(nodes);
});

// Map Nodes
app.get("/mapnodes", async (req, res) => {
  const connDtl = await MapTogetherCreateFs();
  res.send(connDtl);
});

// add a content
app.post("/content", async (req, res) => {
  const cid = await addText(req.body.content);
  res.send(cid);
});

// GET content
app.get("/content/:cid", async (req, res) => {
  const content = await getTextByNode2(req.params.cid);
  res.send(content);
});

async function createNode() {
  // the blockstore is where we store the blocks that make up files
  const blockstore = new MemoryBlockstore();

  // application-specific data lives in the datastore
  const datastore = new MemoryDatastore();

  // libp2p is the networking layer that underpins Helia
  const libp2p = await createLibp2p({
    datastore,
    addresses: {
      listen: ["/ip4/127.0.0.1/tcp/0"],
    },
    transports: [tcp()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      bootstrap({
        list: [
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
        ],
      }),
    ],
    services: {
      identify: identifyService(),
    },
  });

  return await createHelia({
    datastore,
    blockstore,
    libp2p,
  });
}

async function createLocalNodes() {
  // create two helia nodes
  node1 = await createNode();
  node2 = await createNode();

  return [
    {
      node: {
        Id: node1.libp2p.peerId.toString(),
        status: node1.libp2p.isStarted(),
      },
    },
    {
      node: {
        Id: node2.libp2p.peerId.toString(),
        status: node2.libp2p.isStarted(),
      },
    },
  ];
}

async function MapTogetherCreateFs() {
  // connect them together
  const multiaddrs = node2.libp2p.getMultiaddrs();
  const { remotePeer, status } = await node1.libp2p.dial(multiaddrs[0]);

  console.log(remotePeer, status);

  // create a filesystem on top of Helia, in this case it's UnixFS
  fs = unixfs(node1);

  // create a filesystem on top of the second Helia node
  fs2 = unixfs(node2);

  return { remotePeer, status };
}

async function addText(content) {
  // we will use this TextEncoder to turn strings into Uint8Arrays
  const encoder = new TextEncoder();

  // add the bytes to your node and receive a unique content identifier
  const cid = await fs.addBytes(encoder.encode(`${content}`));

  console.log("Added file:", cid.toString());

  return cid.toString();
}

async function getTextByNode2(cid) {
  // this decoder will turn Uint8Arrays into strings
  const decoder = new TextDecoder();
  let content = "";

  // use the second Helia node to fetch the file from the first Helia node
  for await (const chunk of fs2.cat(cid)) {
    content += decoder.decode(chunk, {
      stream: true,
    });
  }
  return {node: node2.libp2p.peerId.toString(), content};
}
