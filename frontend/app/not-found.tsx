import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-gray-500">404</h1>
        <p className="text-xl text-gray-400">Page not found</p>
        <Link
          href="/"
          className="inline-block mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
