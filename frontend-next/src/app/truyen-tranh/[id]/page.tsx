import { MigrationPlaceholder } from '@/components/layout/migration-placeholder';
export default async function MangaDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <MigrationPlaceholder title={`Chi tiết truyện · ${id}`} />; }
