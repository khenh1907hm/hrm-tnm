import type { SupabaseClient } from "@supabase/supabase-js";

export type FileFolder = "certificates" | "signatures" | "employees" | "templates";
const BUCKET = "hr-files";

/** Lưu/tải tệp trong bucket riêng tư `hr-files`, đường dẫn `<thư mục>/<id tệp>`. */
export function createStorageFileStore(client: SupabaseClient) {
  return {
    async put(folder: FileFolder, id: string, file: Blob): Promise<void> {
      const { error } = await client.storage.from(BUCKET).upload(`${folder}/${id}`, file, { upsert: true, ...(file.type ? { contentType: file.type } : {}) });
      if (error) throw new Error(`Không tải được tệp lên kho lưu trữ: ${error.message}`);
    },
    async get(folder: FileFolder, id: string, name: string): Promise<File | null> {
      const { data, error } = await client.storage.from(BUCKET).download(`${folder}/${id}`);
      if (error || !data) return null;
      return new File([data], name, { type: data.type });
    },
  };
}

export type FileStore = ReturnType<typeof createStorageFileStore>;
