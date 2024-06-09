import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import logger from "morgan";
import indexRouter from "./routes/index.js";
import chatsRouter from "./routes/chats.js";
const __dirname = path.resolve();

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/chats', chatsRouter);

export default app;
