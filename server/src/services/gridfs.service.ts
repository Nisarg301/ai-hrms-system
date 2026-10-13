import mongoose from "mongoose";

let bucket: mongoose.mongo.GridFSBucket;

export const initializeGridFS = (): void => {
    if (!mongoose.connection.db) {
        throw new Error(
            "MongoDB connection is not established"
        );
    }

    bucket = new mongoose.mongo.GridFSBucket(
        mongoose.connection.db,
        {
            bucketName: "documents",
        }
    );

    console.log("GridFS initialized");
};

export const getBucket = (): mongoose.mongo.GridFSBucket => {
    if (!bucket) {
        initializeGridFS();
    }
    return bucket;
};

export const uploadFile = ({
    buffer,
    filename,
    contentType,
}: {
    buffer: Buffer;
    filename: string;
    contentType: string;
}): Promise<mongoose.Types.ObjectId> => {
    return new Promise((resolve, reject) => {
        const uploadStream =
            getBucket().openUploadStream(filename, {
                metadata: { contentType },
            });

        uploadStream.end(buffer);

        uploadStream.on("finish", () => {
            resolve(
                uploadStream.id as mongoose.Types.ObjectId
            );
        });

        uploadStream.on("error", reject);
    });
};

export const deleteFile = async (
    fileId: mongoose.Types.ObjectId
): Promise<void> => {
    await getBucket().delete(fileId);
};

export const downloadFile = (
    fileId: mongoose.Types.ObjectId
): mongoose.mongo.GridFSBucketReadStream => {
    return getBucket().openDownloadStream(fileId);
};

