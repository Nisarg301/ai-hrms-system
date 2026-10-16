import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ApiError, errorResponseBody } from '../utils/apiResponse';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
    if (err instanceof ApiError) {
        res.status(err.statusCode).json(errorResponseBody(err.message, err.details));
        return;
    }
    // Upload problems (file too large, unexpected field, ...) are client errors.
    if (err instanceof multer.MulterError) {
        res.status(400).json(errorResponseBody(err.message));
        return;
    }
    console.error(err);
    res.status(500).json(errorResponseBody('Internal server error'));
}
