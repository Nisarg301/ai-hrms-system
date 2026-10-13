export class ApiError extends Error {
    statusCode: number;
    details?: unknown;

    constructor(statusCode: number, message: string, details?: unknown) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
    }
}

export interface ApiSuccessBody<T> {
    success: true;
    data: T;
    meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
    success: false;
    error: { message: string; details?: unknown };
}

export function successResponse<T>(data: T, meta?: Record<string, unknown>): ApiSuccessBody<T> {
    return meta ? { success: true, data, meta } : { success: true, data };
}

export function errorResponseBody(message: string, details?: unknown): ApiErrorBody {
    return details !== undefined ? { success: false, error: { message, details } } : { success: false, error: { message } };
}
