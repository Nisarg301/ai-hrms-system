import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { errorHandler } from './middlewares/errorHandler';
import { env } from './config/env';

export const app: Express = express();

app.use(
    helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
);
app.use(
    cors({
        origin: env.CORS_ORIGIN,
        credentials: true,
        // The frontend is on another origin, so it can only read the download
        // filename (documents, CSV exports) if the header is exposed.
        exposedHeaders: ['Content-Disposition'],
    })
);
app.use(compression());
if (env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
}
app.use(express.json());
app.use(cookieParser());

app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.use(errorHandler);
