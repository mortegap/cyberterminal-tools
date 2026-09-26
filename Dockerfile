# NETRUNNER TERMINAL - Docker Configuration
# nginx-based container for serving static files

FROM nginx:alpine

# Site configuration: cache headers and gzip
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy static files to nginx html directory
COPY index.html manifest.json favicon.svg /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY fonts/ /usr/share/nginx/html/fonts/
COPY data/ /usr/share/nginx/html/data/

# Expose port 80
EXPOSE 80

# Report unhealthy if nginx stops answering
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
