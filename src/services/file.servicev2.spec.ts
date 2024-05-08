import { PrismaClient, files, folders, temp_files } from '@prisma/client';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { FileService } from './file.servicev2';
import { CheckRoleService } from './checkRole.service';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

describe('FileService', () => {
  let service: FileService;
  let prismaService: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FileService, PrismaService, CheckRoleService],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep(PrismaClient))
      .overrideProvider(CheckRoleService)
      .useValue(mockDeep(CheckRoleService))
      .compile();

    service = module.get<FileService>(FileService);
    prismaService = module.get<DeepMockProxy<PrismaClient>>(PrismaService);
    prismaService.$transaction.mockImplementation((callback) =>
      callback(prismaService),
    );
  });

  // Test if the service is defined
  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upload', () => {
    const userId = 1;
    const folderKey = uuidv4();
    const fileName = 'test.txt';
    const chunk = Buffer.from('test');
    const chunkNumber = 0;
    const totalChunks = 1;
    const targetFolder: folders = {
      id: BigInt(1),
      folder_name: 'test',
      parent_folder_id: null,
      folder_key: folderKey,
    };
    const targetFile: files = {
      id: BigInt(1),
      file_name: fileName,
      parent_folder_id: targetFolder.id,
      file_key: uuidv4(),
      enabled: true,
    };
    const tempFile: temp_files = {
      id: BigInt(1),
      temp_file_name: `${targetFolder.folder_key}_${fileName}`,
      uploader_id: userId,
      file_key: uuidv4(),
      total_chunks: totalChunks,
      create_date: new Date(),
    };

    beforeEach(() => {
      prismaService.folders.findUnique.mockResolvedValue(targetFolder);
      prismaService.files.findFirst.mockResolvedValue(null);
      prismaService.temp_files.create.mockResolvedValue(tempFile);
      prismaService.temp_files.findUnique.mockResolvedValue(tempFile);
      prismaService.files.create.mockResolvedValue(targetFile);

      service['uploadChunk'] = jest.fn().mockResolvedValue(null);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: BigInt(4) } as any);
    });

    it('should upload file', async () => {
      const result = await service.upload(
        userId,
        folderKey,
        fileName,
        chunk,
        chunkNumber,
        totalChunks,
      );
      expect(result).toEqual({
        isDone: true,
        fileKey: targetFile.file_key,
      });
    });
    it('should upload file with chunk', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
      const result = await service.upload(
        userId,
        folderKey,
        fileName,
        chunk,
        chunkNumber,
        totalChunks + 1,
      );
      expect(result).toEqual({
        isDone: false,
      });
    });
    it('should throw NotFoundException if folder not found', async () => {
      prismaService.folders.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.upload(
          userId,
          folderKey,
          fileName,
          chunk,
          chunkNumber,
          totalChunks,
        ),
      ).rejects.toThrow(NotFoundException);
    });
    it('should throw ConflictException if file already exists', async () => {
      prismaService.files.findFirst.mockResolvedValue(targetFile);
      await expect(
        service.upload(
          userId,
          folderKey,
          fileName,
          chunk,
          chunkNumber,
          totalChunks,
        ),
      ).rejects.toThrow(ConflictException);
    });
    it('should throw InternalServerErrorException if failed to create file', async () => {
      prismaService.files.create.mockRejectedValue(new Error());
      await expect(
        service.upload(
          userId,
          folderKey,
          fileName,
          chunk,
          chunkNumber,
          totalChunks,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
    it('should throw ConflictException if temp file already exists', async () => {
      prismaService.temp_files.create.mockRejectedValue({
        code: 'P2002',
      });
      await expect(
        service.upload(
          userId,
          folderKey,
          fileName,
          chunk,
          chunkNumber,
          totalChunks,
        ),
      ).rejects.toThrow(ConflictException);
    });
    it('should throw InternalServerErrorException if failed to create temp file', async () => {
      prismaService.temp_files.create.mockRejectedValue(new Error());
      await expect(
        service.upload(
          userId,
          folderKey,
          fileName,
          chunk,
          chunkNumber,
          totalChunks,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
    it('should throw NotFoundException if temp file not found', async () => {
      prismaService.temp_files.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.upload(
          userId,
          folderKey,
          fileName,
          chunk,
          chunkNumber,
          totalChunks,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('download', () => {
    const file: files = {
      id: BigInt(1),
      file_name: 'test.txt',
      parent_folder_id: BigInt(1),
      file_key: uuidv4(),
      enabled: true,
    };

    beforeEach(() => {
      prismaService.files.findUnique.mockResolvedValue(file);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'createReadStream').mockReturnValue({
        pipe: jest.fn(),
      } as any);
    });

    it('should download file', async () => {
      const result = await service.download(file.file_key);
      expect(result).toBeDefined();
    });
    it('should throw NotFoundException if file not found in database', async () => {
      prismaService.files.findUnique.mockResolvedValueOnce(null);
      await expect(service.download(file.file_key)).rejects.toThrow(
        NotFoundException,
      );
    });
    it('should throw NotFoundException if file not found in storage', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
      await expect(service.download(file.file_key)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteFile', () => {
    const file: files = {
      id: BigInt(1),
      file_name: 'test.txt',
      parent_folder_id: BigInt(1),
      file_key: uuidv4(),
      enabled: true,
    };

    beforeEach(() => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs.promises, 'rm').mockResolvedValue();
      prismaService.files.delete.mockResolvedValue(file);
    });

    it('should delete file', async () => {
      const result = await service.deleteFile(file.file_key);
      expect(result).toBeUndefined();
    });
    it('should throw NotFoundException if file not found in storage', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
      await expect(service.deleteFile(file.file_key)).rejects.toThrow(
        NotFoundException,
      );
    });
    it('should throw InternalServerErrorException if failed to delete file', async () => {
      jest.spyOn(fs.promises, 'rm').mockImplementation(() => {
        return Promise.reject(new Error());
      });
      await expect(service.deleteFile(file.file_key)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
    it('should throw InternalServerErrorException if failed to delete file in database', async () => {
      prismaService.files.delete.mockRejectedValue(new Error());
      await expect(service.deleteFile(file.file_key)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('renameFile', () => {
    const file: files = {
      id: BigInt(1),
      file_name: 'test.txt',
      parent_folder_id: BigInt(1),
      file_key: uuidv4(),
      enabled: true,
    };
    const newFileName = 'new.txt';

    beforeEach(() => {
      prismaService.files.update.mockResolvedValue(file);
    });

    it('should rename file', async () => {
      const result = await service.renameFile(file.file_key, newFileName);
      expect(result).toBeUndefined();
    });
    it('should throw InternalServerErrorException if failed to rename file in database', async () => {
      prismaService.files.update.mockRejectedValue(new Error());
      await expect(
        service.renameFile(file.file_key, newFileName),
      ).rejects.toThrow(InternalServerErrorException);
    });
    it('should throw ConflictException if file already exists', async () => {
      prismaService.files.update.mockRejectedValue({
        code: 'P2002',
      });
      await expect(
        service.renameFile(file.file_key, newFileName),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateParent', () => {
    const file: files = {
      id: BigInt(1),
      file_name: 'test.txt',
      parent_folder_id: BigInt(1),
      file_key: uuidv4(),
      enabled: true,
    };
    const targetFolder: folders = {
      id: BigInt(2),
      folder_name: 'test',
      parent_folder_id: null,
      folder_key: uuidv4(),
    };

    beforeEach(() => {
      prismaService.folders.findUnique.mockResolvedValue(targetFolder);
      prismaService.files.update.mockResolvedValue(file);
    });

    it('should move file to another folder', async () => {
      const result = await service.updateParent(
        file.file_key,
        targetFolder.folder_key,
      );
      expect(result).toBeUndefined();
    });
    it('should throw NotFoundException if target folder not found', async () => {
      prismaService.folders.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.updateParent(file.file_key, targetFolder.folder_key),
      ).rejects.toThrow(NotFoundException);
    });
    it('should throw InternalServerErrorException if failed to move file in database', async () => {
      prismaService.files.update.mockRejectedValue(new Error());
      await expect(
        service.updateParent(file.file_key, targetFolder.folder_key),
      ).rejects.toThrow(InternalServerErrorException);
    });
    it('should throw ConflictException if file already exists', async () => {
      prismaService.files.update.mockRejectedValue({
        code: 'P2002',
      });
      await expect(
        service.updateParent(file.file_key, targetFolder.folder_key),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('uploadChunk', () => {
    const chunk = Buffer.from('test');
    const chunkNumber = 0;
    const totalChunks = 2;
    const fileKey = uuidv4();

    beforeEach(() => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      jest.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      service['mergeChunks'] = jest.fn().mockResolvedValue(null);
    });

    it('should upload chunk', async () => {
      expect(
        service['uploadChunk'](chunk, chunkNumber, totalChunks, fileKey),
      ).resolves.toBeUndefined();
    });
    it('should merge chunks if it is the last chunk', async () => {
      await service['uploadChunk'](
        chunk,
        totalChunks - 1,
        totalChunks,
        fileKey,
      );
      expect(service['mergeChunks']).toHaveBeenCalled();
    });
    it('should throw InternalServerErrorException if failed to write chunk', async () => {
      jest.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error());
      await expect(
        service['uploadChunk'](chunk, chunkNumber, totalChunks, fileKey),
      ).rejects.toThrow(InternalServerErrorException);
    });
    it('should make directory if it does not exist', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
      await service['uploadChunk'](chunk, chunkNumber, totalChunks, fileKey);
      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('mergeChunks', () => {
    const fileKey = uuidv4();
    const totalChunks = 2;

    beforeEach(() => {
      jest.spyOn(fs, 'createWriteStream').mockReturnValue({
        write: jest.fn(),
        end: jest.fn(),
      } as any);
      jest
        .spyOn(fs.promises, 'readFile')
        .mockResolvedValue(Buffer.from('test'));
      jest.spyOn(fs.promises, 'unlink').mockResolvedValue();
    });

    it('should merge chunks', async () => {
      expect(
        service['mergeChunks'](fileKey, totalChunks),
      ).resolves.toBeUndefined();
    });
    it('should throw InternalServerErrorException if failed to delete chunk', async () => {
      jest.spyOn(fs.promises, 'unlink').mockRejectedValue(new Error());
      await expect(
        service['mergeChunks'](fileKey, totalChunks),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});