import express from "express";
const router = express.Router();
import {mongoose} from "mongoose";
import got from 'got';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';

// enable mongoose debug mode
mongoose.set('debug', true);

//define chat mongoose model
const chatSchema = new mongoose.Schema({
    chatId: String,
    response: String
});
const Chat = mongoose.model('Chat', chatSchema);

/* GET chats */
router.get('/', async function (req, res, next) {
    // connect to the database
    await mongoose.connect('mongodb://localhost:27017/learn_ollama');
    // use Chat model to get all chats
    const chats = await Chat.find();
    res.json(chats);
});

// get chat by id
router.get('/:id', async function (req, res, next) {
    // connect to the database
    await mongoose.connect('mongodb://localhost:27017/learn_ollama');
    // use Chat model to get chat by id
    const chat = await Chat.findOne({chatId: req.params.id});
    res.json(chat);
});

const waitForChatToBePersisted = async (chatId) => {
    let chatFromDb;
    let retries = 0;
    while (retries < 5) {
        try {
            await mongoose.connect('mongodb://localhost:27017/learn_ollama');
            chatFromDb = await Chat.findOne({chatId});
            if (chatFromDb) {
                break;
            } else {
                console.log(`Chat not saved yet id = ${chatId}. Retry = ${retries}`);
            }
        } catch (err) {
            console.log(`Chat not saved yet id = ${chatId}. Retry = ${retries}`);
        }
        retries++;
        // random delay between 1 and 5 seconds
        let randomDelay = Math.floor(Math.random() * 5000) + 1000;
        console.log(`Waiting for ${randomDelay} ms`);
        await new Promise((resolve) => setTimeout(resolve, randomDelay));
    }
    return chatFromDb;
}

class SSETransformStream extends Transform {
    constructor(chatId) {
        super();
        this.chatId = chatId;
        this.lineNumber = 0;
        this.isDone = false;
    }

    _transform(chunk, encoding, callback) {
        let data = chunk.toString();
        try {
            // for first line send chatId
            if (this.lineNumber === 0) {
                let strToSend = `id:${this.lineNumber}\ndata:{"chatId":"${this.chatId}"}\n\n`;
                this.push(strToSend);
                this.lineNumber++;
            } else {
                // split on newline
                const lines = data.split('\n');
                for (let i = 0; i < lines.length - 1; i++) {
                    const dataJson = JSON.parse(lines[i]);
                    this.lineNumber++;
                    let strToSend = `event:message\ndata:${dataJson.response}\nid:${this.lineNumber}\n\n`;
                    this.push(strToSend);
                    if(dataJson.done) {
                        this.isDone = true;
                        break;
                    }
                }
            }
            if(this.isDone) {
                waitForChatToBePersisted(this.chatId).then(() => {
                    this.lineNumber++;
                    let strToSend = `event:message\ndata:{"chatId":"${this.chatId}","done":true}\nid:${this.lineNumber}\n\n`;
                    this.push(strToSend);
                    callback(null, this.chunk);
                });
            } else {
                callback(null, this.chunk);
            }
        } catch (e) {
            console.error(e);
            callback(e);
        }
    }
}

class DBTransformStream extends Transform {
    constructor() {
        super();
    }

    _transform(chunk, encoding, callback) {
        let data = chunk.toString();
        let lines = data.split('\n');
        lines.forEach((line) => {
            if (line) {
                const dataJson = JSON.parse(line);
                this.push(`${dataJson.response}`);
            }
        });
        callback(null, this.chunk);
    }
}

const saveChat = async (chatId, buffer) => {
    // connect to the database
    await mongoose.connect('mongodb://localhost:27017/learn_ollama');
    // use DBTransformStream
    const dbTransformStream = new DBTransformStream();
    buffer.pipe(dbTransformStream);
    let aiResponseText = '';
    // add delay of 15 seconds
    await new Promise((resolve) => setTimeout(resolve, 15000));
    dbTransformStream.on('data', (chunk) => {
        aiResponseText += chunk;
    });
    dbTransformStream.on('end', async () => {
        // create a new chat object
        const chat = new Chat({chatId, response: aiResponseText});
        await chat.save();
        console.log('Chat saved');
    });
    dbTransformStream.on('error', (err) => {
        console.error(err);
    });
}

/* POST chats */
router.post('/', async function (req, res) {
    const prompt = 'Write me a long essay about the importance of the internet in the modern world.';
    // use got to make a POST request to the ollama API and stream response
    const stream = got.stream.post('http://localhost:11434/api/generate', {
        json: {
            model: 'llama3',
            prompt: prompt,
            stream: true
        }
    });
    const chatId = randomUUID();
    saveChat(chatId, stream); // no await
    res.set('Content-Type', 'text/event-stream');
    res.set('Cache-Control', 'no-cache, no-transform');
    res.set('Connection', 'keep-alive');
    await pipeline(stream, new SSETransformStream(chatId), res);
});

export default router;
