import multer from 'multer';
import { ApiError } from '../utils/apiResponse';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'];

function createUpload(allowedTypes: string[]) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (!allowedTypes.includes(file.mimetype)) {
        cb(new ApiError(400, 'Unsupported file type'));
        return;
      }
      cb(null, true);
    },
  });
}

// Document attachments: PDFs, Word files, and images.
export const upload = createUpload(DOCUMENT_MIME_TYPES);

// Profile pictures: images only.
export const avatarUpload = createUpload(IMAGE_MIME_TYPES);

// Expense receipts: PDFs and photos.
export const receiptUpload = createUpload(['application/pdf', ...IMAGE_MIME_TYPES]);

// Files on onboarding/offboarding tasks (ID proof, handover notes, letters): PDFs and photos.
export const taskFileUpload = createUpload(['application/pdf', ...IMAGE_MIME_TYPES]);
