FROM golang:1.26.1-alpine3.23 AS builder

WORKDIR /app

RUN apk add --no-cache git

ARG GO_KIT_GITHUB_TOKEN
RUN git config --global url."https://${GO_KIT_GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
ENV GOPRIVATE=github.com/shivanand-burli/*

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 \
    GOOS=linux \
    GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o app

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/app /app/app
EXPOSE 8080
CMD ["/app/app"]
