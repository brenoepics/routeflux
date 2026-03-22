import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp run check -r",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
});
