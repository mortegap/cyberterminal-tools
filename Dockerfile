# NETRUNNER TERMINAL - Docker Configuration
# nginx-based container for serving static files

FROM nginx:alpine

# Copy static files to nginx html directory
COPY index.html manifest.json favicon.svg /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY fonts/ /usr/share/nginx/html/fonts/
COPY data/ /usr/share/nginx/html/data/

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
