export const NEXUS_APPS = [
  { id: 'cloud', name: 'Google Cloud', description: 'Gemini y Vertex AI para trabajar con Uony.', category: 'Inteligencia artificial', icon: 'google-cloud.png', available: true },
  { id: 'drive', name: 'Google Drive', description: 'Tus documentos, imágenes y archivos de producto.', category: 'Archivos y contenido', icon: 'google-drive.png', available: true },
  { id: 'blender', name: 'Blender', description: 'Tu escena y sus vistas previas, en tu ordenador.', category: 'Diseño y contenido 3D', icon: 'blender-logo.svg', available: true },
  { id: 'amazon', name: 'Amazon Seller Central', description: 'Tu catálogo y tus publicaciones en Amazon.', category: 'Canales de venta', icon: 'amazon-logo.svg', available: false },
  { id: 'chatgpt', name: 'ChatGPT', description: 'Conecta tu cuenta con las herramientas de Uonify.', category: 'Inteligencia artificial', icon: 'openai-blossom.svg', available: false },
] as const;
export type NexusApp = typeof NEXUS_APPS[number];
