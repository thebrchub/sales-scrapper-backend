FROM golang:1.24-alpine AS builder

ARG GO_KIT_GITHUB_TOKEN
RUN apk add --no-cache git
RUN git config --global url."https://${GO_KIT_GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
ENV GOPRIVATE=github.com/shivanand-burli/go-starter-kit

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /api .

FROM gcr.io/distroless/static-debian12
COPY --from=builder /api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
