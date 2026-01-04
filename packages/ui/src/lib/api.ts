const API_BASE = "/api";

export const api = {
  personalities: {
    uploadAvatar: async (name: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_BASE}/personalities/${encodeURIComponent(name)}/avatar`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error ${response.status}: ${error}`);
      }
      return response.json() as Promise<{ status: string; avatar: string }>;
    },
  },
};
