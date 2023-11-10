import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// // Set up multer for file uploads
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, "uploads/"); // Uploads will be stored in the 'uploads/' directory
//   },
//   filename: function (req, file, cb) {
//     const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
//     cb(
//       null,
//       file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
//     );
//   },
// });

// Set up Multer to handle file uploads
const storage = multer.memoryStorage();

const upload = multer({ storage: storage });

app.use(express.json());
app.use(cors());

// Serve static files in the 'uploads/' directory
app.use("/uploads", express.static("uploads"));

// listen
app.listen(port, () => {
  console.log(`node server is running on port: ${port}`);
});

// GET
app.get("/", (req, res) => {
  res.send(`Hello IPFS!`);
});

// CreateNodes

app.get("/api/createnodes", async (req, res) => {
  const nodes = await createLocalNodes();
  res.send(nodes);
});

// Map Nodes
app.get("/api/mapnodes", async (req, res) => {
  const connDtl = await MapTogetherCreateFs();
  res.send(connDtl);
});

// add a content
app.post("/api/content", async (req, res) => {
  const cid = await addText(req.body.content);
  res.status(200).json(cid);
});

// GET content
app.get("/api/content/:cid", async (req, res) => {
  const content = await getTextByNode2(req.params.cid);
  res.json(content);
});

// Define a route for handling file uploads
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  // Process the uploaded file as needed
  const data = await uploadFile(
    req.file.originalname,
    req.file.buffer.toString()
  );

  // For now, just send a success response with file details
  res.status(200).json({
    message: "File uploaded successfully",
    file: {
      filename: req.file.originalname,
      size: req.file.size,
      data,
    },
  });
});

// GET file
app.get("/api/file/:cid", async (req, res) => {
  const content = await getFileByNode2(req.params.cid);
  res.json(content);
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
      id: node1.libp2p.peerId.toString(),
      status: node1.libp2p.isStarted(),
    },
    {
      id: node2.libp2p.peerId.toString(),
      status: node2.libp2p.isStarted(),
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
  return { node: node2.libp2p.peerId.toString(), content };
}

async function getFileByNode2(cid) {
  // this decoder will turn Uint8Arrays into strings
  const decoder = new TextDecoder();
  let content = "";

  // use the second Helia node to fetch the file from the first Helia node
  for await (const chunk of fs2.cat(cid)) {
    content += decoder.decode(chunk, {
      stream: true,
    });
  }
  return { node: node2.libp2p.peerId.toString(),  content };
}

async function uploadFile(name, content) {
  let dCid = '';
  try {
    const emptyDirCid = await fs.addDirectory('uploads');
    dCid = await fs.mkdir(emptyDirCid, 'uploads');
  } catch (e) {
    console.error(e);
  }
  let cid;

  try {
    cid = await fs.addFile({
      path: `${name}`,
      content: new TextEncoder().encode(content)
    })
    const updatedCid = await fs.cp(cid, dCid, name)
    return { dirCid: updatedCid.toString(), fileCid: cid.toString() };
  } catch (e) {
    console.error(e)
  }
        
  // const fileToAdd = {
  //   path: `${name}`,
  //   content: new TextEncoder().encode(content), // we will use this TextEncoder to turn strings into Uint8Arrays
  // };

  // // add the bytes to your node and receive a unique content identifier
  // const cid = await fs.addFile(fileToAdd);



  // console.log("Added file:", cid.toString());

  // return cid.toString();
}
