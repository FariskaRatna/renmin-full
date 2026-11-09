FROM golang:1.27.2-alpine3.24 AS build
WORKDIR /src
ENV GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go test ./...
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/api ./cmd/api

FROM alpine:3.24
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN addgroup -S sdl && adduser -S -G sdl sdl
COPY --from=build /out/api /api
USER sdl
EXPOSE 8080
ENTRYPOINT ["/api"]
