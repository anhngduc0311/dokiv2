<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  exclude-result-prefixes="s">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/">
    <html lang="vi">
      <head>
        <title>Sơ đồ trang web XML — DokiTruyen</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; background: #f5f7fa; color: #243247; font: 15px/1.6 system-ui, sans-serif; }
          header { background: #18263d; color: #fff; padding: 36px max(24px, calc((100% - 1100px) / 2)); }
          header a { color: #b9d9ff; }
          h1 { margin: 0 0 12px; font-size: clamp(24px, 4vw, 32px); }
          p { margin: 8px 0; }
          main { max-width: 1148px; margin: 32px auto; padding: 0 24px; }
          a { color: #195dae; text-decoration: none; }
          a:hover { text-decoration: underline; }
          a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
          .table-wrap { overflow-x: auto; margin-top: 20px; border: 1px solid #dce3ed; border-radius: 8px; background: #fff; }
          table { width: 100%; border-collapse: collapse; text-align: left; }
          th { background: #eaf0f7; font-weight: 600; }
          th, td { padding: 13px 18px; border-bottom: 1px solid #e5eaf1; vertical-align: top; }
          tr:last-child td { border-bottom: 0; }
          tbody tr:hover { background: #f4f8ff; }
          td:first-child { overflow-wrap: anywhere; }
          th:last-child, td:last-child { width: 230px; white-space: nowrap; }
          .muted { color: #64748b; }
        </style>
      </head>
      <body>
        <header>
          <h1>Sơ đồ trang web XML</h1>
          <p>Sitemap tự động của <a href="/">DokiTruyen</a>, giúp công cụ tìm kiếm khám phá các trang công khai.</p>
        </header>
        <main>
          <xsl:choose>
            <xsl:when test="s:sitemapindex">
              <p>Chỉ mục này chứa <strong><xsl:value-of select="count(s:sitemapindex/s:sitemap)"/></strong> sơ đồ trang web.</p>
            </xsl:when>
            <xsl:otherwise>
              <p>Sơ đồ trang web này chứa <strong><xsl:value-of select="count(s:urlset/s:url)"/></strong> URL.</p>
              <p><a href="/sitemap_index.xml">← Chỉ mục sơ đồ trang web</a></p>
            </xsl:otherwise>
          </xsl:choose>
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th scope="col"><xsl:choose><xsl:when test="s:sitemapindex">Sơ đồ trang web</xsl:when><xsl:otherwise>URL</xsl:otherwise></xsl:choose></th>
                <th scope="col">Cập nhật lần cuối (UTC)</th>
              </tr></thead>
              <tbody>
                <xsl:for-each select="s:sitemapindex/s:sitemap | s:urlset/s:url">
                  <tr>
                    <td><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
                    <td><xsl:choose>
                      <xsl:when test="s:lastmod"><xsl:value-of select="translate(substring(s:lastmod, 1, 19), 'T', ' ')"/></xsl:when>
                      <xsl:otherwise><span class="muted">—</span></xsl:otherwise>
                    </xsl:choose></td>
                  </tr>
                </xsl:for-each>
              </tbody>
            </table>
          </div>
          <p class="muted">Chỉ liệt kê nội dung công khai. Ngày cập nhật được lấy từ dữ liệu đã lưu.</p>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
