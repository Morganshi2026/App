import fileURIToPath from '@libs/fileURIToPath';

import type {FileObject} from '@src/types/utils/Attachment';

import {manipulateAsync} from 'expo-image-manipulator';
import RNFetchBlob from 'react-native-blob-util';

import type ImageManipulatorConfig from './type';

export default function getImageManipulator({fileUri, width, height, type, fileName}: ImageManipulatorConfig): Promise<FileObject> {
    return manipulateAsync(fileUri ?? '', [{resize: {width, height}}]).then((result) => {
        const resizedFile: FileObject = {
            uri: result.uri,
            width: result.width,
            height: result.height,
            type,
            name: fileName,
        };

        // The size of the manipulated file is not reported by the manipulator, so it is read from disk: the upload limit
        // is checked against the size of the resized file, and without it the resized file can't be checked at all.
        return RNFetchBlob.fs
            .stat(fileURIToPath(result.uri))
            .then((stats) => ({...resizedFile, size: stats.size}))
            .catch(() => resizedFile);
    });
}
