# Stackify - Privacy is Normal

A zk-powered shielded pool bringing private, trustless transactions to the Stacks blockchain.

## 🚀 Deployment Guide

### Prerequisites
- Node.js 18+ installed
- Vercel account
- Supabase project set up

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env` file in the root directory:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. **Build for production:**
   ```bash
   npm run build
   ```

### Deploying to Vercel

#### Option 1: Deploy via Vercel CLI

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel:**
   ```bash
   vercel login
   ```

3. **Deploy:**
   ```bash
   vercel
   ```

4. **Set environment variables:**
   ```bash
   vercel env add VITE_SUPABASE_URL
   vercel env add VITE_SUPABASE_ANON_KEY
   ```

5. **Deploy to production:**
   ```bash
   vercel --prod
   ```

#### Option 2: Deploy via Vercel Dashboard

1. **Push your code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/yourusername/stackify.git
   git push -u origin main
   ```

2. **Import to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your GitHub repository
   - Configure project:
     - Framework Preset: Vite
     - Root Directory: ./
     - Build Command: `npm run build`
     - Output Directory: `dist`

3. **Add Environment Variables:**
   In Vercel project settings, add:
   - `VITE_SUPABASE_URL` → Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` → Your Supabase anon key

4. **Deploy!**

### Deploying Supabase Edge Functions

Your backend server needs to be deployed to Supabase:

1. **Install Supabase CLI:**
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase:**
   ```bash
   supabase login
   ```

3. **Link your project:**
   ```bash
   supabase link --project-ref your-project-ref
   ```

4. **Deploy the edge function:**
   ```bash
   supabase functions deploy make-server-7871649b
   ```

### Update API Configuration

After deployment, update `/utils/supabase/info.tsx` with your production Supabase credentials:

```tsx
export const projectId = "your-project-id";
export const publicAnonKey = "your-anon-key";
```

## 📁 Project Structure

```
src/
├── App.tsx              # Main application component
├── main.tsx            # Application entry point
├── components/         # React components
│   ├── FeatureCard.tsx
│   ├── RoadmapItem.tsx
│   ├── WaitlistDialog.tsx
│   └── ui/            # Shadcn UI components
├── styles/
│   └── globals.css    # Tailwind v4 styles
└── utils/
    └── supabase/      # Supabase configuration
```

## 🔒 Environment Variables

Required environment variables:
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key

## 🛠️ Tech Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS v4
- **Backend:** Supabase (Edge Functions, Storage, Auth)
- **Animations:** Motion (Framer Motion)
- **Icons:** Lucide React
- **Deployment:** Vercel
- **UI Components:** Shadcn UI

## 📝 Notes

- Make sure your Supabase edge function is deployed before testing the waitlist feature
- The app uses dark mode by default
- Waitlist emails are stored in Supabase KV store

## 🚀 Built with ❤️ on Stacks
