# syntax=docker/dockerfile:1
# Single production image: ASP.NET Core serves the API and the built Angular app from one origin,
# so the auth cookie stays first-party.

FROM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npx ng build --configuration production

FROM mcr.microsoft.com/dotnet/sdk:11.0 AS api
WORKDIR /src
COPY Directory.Build.props ./
COPY api/src/DocRoof.Domain/DocRoof.Domain.csproj api/src/DocRoof.Domain/
COPY api/src/DocRoof.Infrastructure/DocRoof.Infrastructure.csproj api/src/DocRoof.Infrastructure/
COPY api/src/DocRoof.Api/DocRoof.Api.csproj api/src/DocRoof.Api/
RUN dotnet restore api/src/DocRoof.Api/DocRoof.Api.csproj
COPY api/src/ api/src/
RUN dotnet publish api/src/DocRoof.Api/DocRoof.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:11.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true \
    Storage__LocalPath=/app/data/files
COPY --from=api /app ./
COPY --from=web /src/web/dist/web/browser ./wwwroot
RUN mkdir -p /app/data/files && chown -R app:app /app/data
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["dotnet", "DocRoof.Api.dll", "--healthcheck"]
ENTRYPOINT ["dotnet", "DocRoof.Api.dll"]
