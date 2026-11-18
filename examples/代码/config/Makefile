APP     := demo
VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo dev)
GOFLAGS := -trimpath
LDFLAGS := -s -w -X main.version=$(VERSION)
SRCS    := $(shell find . -name '*.go' -not -path './vendor/*')

.PHONY: all build test lint clean help

all: lint test build ## 检查、测试并构建

build: bin/$(APP) ## 构建二进制

bin/$(APP): $(SRCS) go.mod
	@mkdir -p $(@D)
	go build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o $@ ./cmd/$(APP)

test: ## 运行单元测试
	go test -race -cover ./...

lint: ## 静态检查
	golangci-lint run

clean: ## 清理产物
	rm -rf bin/ coverage.out

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
