-- Neovim 配置片段：插件管理 + 常用键位
local opt = vim.opt

opt.number = true
opt.relativenumber = true
opt.expandtab = true
opt.shiftwidth = 2
opt.clipboard = "unnamedplus"

vim.g.mapleader = " "

local map = function(mode, lhs, rhs, desc)
  vim.keymap.set(mode, lhs, rhs, { silent = true, desc = desc })
end

map("n", "<leader>w", "<cmd>write<cr>", "保存")
map("n", "<leader>q", "<cmd>quit<cr>", "退出")
map({ "n", "v" }, "H", "^", "行首")
map({ "n", "v" }, "L", "$", "行尾")

-- 自动安装 lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  vim.fn.system({ "git", "clone", "--filter=blob:none", "https://github.com/folke/lazy.nvim.git", lazypath })
end
opt.rtp:prepend(lazypath)

require("lazy").setup({
  { "folke/tokyonight.nvim", priority = 1000, config = function() vim.cmd.colorscheme("tokyonight") end },
  { "nvim-telescope/telescope.nvim", dependencies = { "nvim-lua/plenary.nvim" },
    keys = { { "<leader>f", "<cmd>Telescope find_files<cr>", desc = "找文件" } } },
})

vim.api.nvim_create_autocmd("TextYankPost", {
  callback = function() vim.highlight.on_yank({ timeout = 150 }) end,
})
