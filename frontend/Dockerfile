# --- Stage 1: Build the React App ---
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the app (this creates the /dist folder with HTML/CSS/JS)
RUN npm run build

# --- Stage 2: Serve with Nginx ---
FROM nginx:alpine

# Copy the build output from Stage 1 to Nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy a custom nginx config (we will create this in a second)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]