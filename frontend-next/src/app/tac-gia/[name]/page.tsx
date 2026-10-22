import { MigrationPlaceholder } from '@/components/layout/migration-placeholder';
export default async function AuthorPage({ params }: { params: Promise<{ name: string }> }) { const { name } = await params; return <MigrationPlaceholder title={`Tác giả: ${decodeURIComponent(name)}`} />; }
