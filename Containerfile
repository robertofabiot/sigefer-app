FROM scratch
COPY sigefer /sigefer
EXPOSE 8080
ENTRYPOINT ["/sigefer"]
