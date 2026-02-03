require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// Configuration from environment variables
const BLOG_ROOT = process.env.BLOG_ROOT;
const VAULT_ROOT = process.env.VAULT_ROOT || path.dirname(BLOG_ROOT);
const SITE_TITLE = process.env.SITE_TITLE || 'My Blog';
const SITE_DESCRIPTION = process.env.SITE_DESCRIPTION || 'Thoughts, stories, and ideas.';
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

// Source folders
const FRACTAL_SOURCE = path.join(BLOG_ROOT, 'Fractal');
const MAIN_SOURCE = path.join(BLOG_ROOT, 'Main');
const PROJECTS_SOURCE = path.join(BLOG_ROOT, 'Projects');

// Output paths
const POSTS_OUTPUT = path.join(__dirname, 'posts');
const SERIES_OUTPUT = path.join(__dirname, 'series');
const IMAGES_OUTPUT = path.join(__dirname, 'images');
const INDEX_PATH = path.join(__dirname, 'index.html');
const WRITING_PATH = path.join(__dirname, 'writing.html');

// Track images to copy
const imagesToCopy = new Set();

// Validate required config
if (!BLOG_ROOT) {
    console.error('Error: BLOG_ROOT not set in .env file');
    process.exit(1);
}

// Find image in Obsidian vault
function findImageInVault(imageName) {
    // Common locations to search for images
    const searchPaths = [
        path.join(VAULT_ROOT, imageName),
        path.join(VAULT_ROOT, 'attachments', imageName),
        path.join(VAULT_ROOT, 'Attachments', imageName),
        path.join(VAULT_ROOT, 'images', imageName),
        path.join(VAULT_ROOT, 'Images', imageName),
        path.join(BLOG_ROOT, imageName),
        path.join(BLOG_ROOT, 'images', imageName),
    ];

    for (const searchPath of searchPaths) {
        if (fs.existsSync(searchPath)) {
            return searchPath;
        }
    }

    return null;
}

// Convert Obsidian wiki-links to standard markdown
function convertObsidianImages(content) {
    // Match ![[filename.ext]] pattern
    const wikiImageRegex = /!\[\[([^\]]+)\]\]/g;

    return content.replace(wikiImageRegex, (match, imageName) => {
        // Handle potential alt text: ![[image.png|alt text]]
        const parts = imageName.split('|');
        const filename = parts[0].trim();
        const altText = parts[1]?.trim() || filename.replace(/\.[^.]+$/, ''); // Remove extension for alt text

        // Find the image in the vault
        const imagePath = findImageInVault(filename);
        if (imagePath) {
            imagesToCopy.add({ source: imagePath, filename });
        } else {
            console.warn(`  ⚠ Image not found: ${filename}`);
        }

        // URL-encode the filename for spaces and special characters
        const encodedFilename = encodeURIComponent(filename);

        // Convert to standard markdown with /images/ path
        return `![${altText}](/images/${encodedFilename})`;
    });
}

// Parse your Obsidian frontmatter format
function parsePost(content, filename) {
    const lines = content.split('\n');
    let date = null;
    let title = null;
    let description = null;
    let tags = [];
    let image = null;
    let draft = false;
    let bodyStartIndex = 0;

    // Look for frontmatter fields
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('**Date**:')) {
            const dateStr = line.replace('**Date**:', '').trim();
            date = parseDate(dateStr);
            continue;
        }
        if (line.startsWith('**Title**:')) {
            title = line.replace('**Title**:', '').trim();
            continue;
        }
        if (line.startsWith('**Description**:')) {
            description = line.replace('**Description**:', '').trim();
            continue;
        }
        if (line.startsWith('**Tags**:')) {
            tags = line.replace('**Tags**:', '').trim().split(',').map(t => t.trim().toLowerCase());
            continue;
        }
        if (line.startsWith('**Image**:')) {
            image = line.replace('**Image**:', '').trim();
            continue;
        }
        if (line.startsWith('**Draft**:')) {
            draft = line.replace('**Draft**:', '').trim().toLowerCase() === 'true';
            continue;
        }

        // Skip the --- separator
        if (line === '---') {
            bodyStartIndex = i + 1;
            break;
        }
    }

    let body = lines.slice(bodyStartIndex).join('\n').trim();

    // Convert Obsidian wiki-link images to standard markdown
    body = convertObsidianImages(body);

    // Generate title from filename if not specified (remove number prefix and extension)
    if (!title) {
        title = filename
            .replace(/\.md$/, '')
            .replace(/^\d+\.\s*/, '')
            .trim();
    }

    // Generate slug from filename
    const slug = filename
        .replace(/\.md$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    // Extract post number from filename for series ordering
    const numberMatch = filename.match(/^(\d+)\./);
    const postNumber = numberMatch ? parseInt(numberMatch[1], 10) : null;

    return {
        title,
        slug,
        date,
        description,
        tags,
        image,
        draft,
        body,
        postNumber,
        html: marked(body)
    };
}

// Read posts from a folder (supports both numbered and non-numbered files)
function readPostsFromFolder(folderPath, requireNumber = true) {
    if (!fs.existsSync(folderPath)) {
        return [];
    }

    const files = fs.readdirSync(folderPath).filter(f => {
        if (!f.endsWith('.md')) return false;
        if (f.toUpperCase().startsWith('STYLE_GUIDE')) return false;
        if (requireNumber) return /^\d+\./.test(f);
        return true;
    });

    const posts = [];
    for (const file of files) {
        const filePath = path.join(folderPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const post = parsePost(content, file);

        if (!post.draft) {
            posts.push(post);
        }
    }

    return posts;
}

// Parse date string (handles M-D-YYYY format)
function parseDate(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const [month, day, year] = parts.map(Number);
        return new Date(year, month - 1, day);
    }
    return new Date(dateStr);
}

// Format date for display
function formatDate(date) {
    if (!date || isNaN(date)) return 'Unknown date';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Get excerpt from post body or use description
function getExcerpt(post, maxLength = 150) {
    if (post.description) return post.description;
    const text = post.body.replace(/[#*_`\[\]!]/g, '').replace(/\(.*?\)/g, '').trim();
    const firstParagraph = text.split('\n\n')[0];
    if (firstParagraph.length <= maxLength) return firstParagraph;
    return firstParagraph.substring(0, maxLength).trim() + '...';
}

// Parse project file
function parseProject(content, filename) {
    const lines = content.split('\n');
    let title = null;
    let description = null;
    let descriptionLines = [];
    let url = null;
    let role = null;
    let tech = [];
    let image = null;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Handle code block for multi-line description
        if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) {
            // Collect lines inside code block
            descriptionLines.push(lines[i]); // Keep original indentation
            continue;
        }

        if (line.startsWith('**Title**:')) {
            title = line.replace('**Title**:', '').trim();
            continue;
        }
        if (line.startsWith('**Description**:')) {
            const sameLine = line.replace('**Description**:', '').trim();
            description = sameLine; // Could be empty if code block follows
            continue;
        }
        if (line.startsWith('**URL**:')) {
            url = line.replace('**URL**:', '').trim();
            continue;
        }
        if (line.startsWith('**Role**:')) {
            role = line.replace('**Role**:', '').trim();
            continue;
        }
        if (line.startsWith('**Tech**:')) {
            tech = line.replace('**Tech**:', '').trim().split(',').map(t => t.trim());
            continue;
        }
        if (line.startsWith('**Image**:')) {
            // Check if image is on the same line or next line
            const sameLine = line.replace('**Image**:', '').trim();
            if (sameLine) {
                // Check for wiki-link syntax: ![[filename.png]]
                const wikiMatch = sameLine.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
                if (wikiMatch) {
                    const imageFilename = wikiMatch[1].trim();
                    const imagePath = findImageInVault(imageFilename);
                    if (imagePath) {
                        imagesToCopy.add({ source: imagePath, filename: imageFilename });
                        image = imageFilename;
                    } else {
                        console.warn(`  ⚠ Project image not found: ${imageFilename}`);
                    }
                } else {
                    image = sameLine;
                }
            }
            continue;
        }

        // Check for wiki-link image syntax: ![[filename.png]]
        const wikiMatch = line.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
        if (wikiMatch && !image) {
            const imageFilename = wikiMatch[1].trim();
            // Find and queue image for copying
            const imagePath = findImageInVault(imageFilename);
            if (imagePath) {
                imagesToCopy.add({ source: imagePath, filename: imageFilename });
                image = imageFilename;
            } else {
                console.warn(`  ⚠ Project image not found: ${imageFilename}`);
            }
            continue;
        }

        if (line === '---') break;
    }

    // If we collected multi-line description from code block, use it
    if (descriptionLines.length > 0) {
        description = descriptionLines
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .join('\n');
    }

    // Generate title from filename if not specified
    if (!title) {
        title = filename.replace(/\.md$/, '').replace(/^\d+\.\s*/, '').trim();
    }

    // Extract order from filename
    const numberMatch = filename.match(/^(\d+)\./);
    const order = numberMatch ? parseInt(numberMatch[1], 10) : 999;

    return { title, description, url, role, tech, image, order };
}

// Read projects from folder
function readProjectsFromFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        return [];
    }

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));
    const projects = [];

    for (const file of files) {
        const filePath = path.join(folderPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const project = parseProject(content, file);
        projects.push(project);
    }

    return projects.sort((a, b) => a.order - b.order);
}

// Generate nav HTML
function generateNav(activePage = '') {
    const homeActive = activePage === 'home' ? ' class="active"' : '';
    const writingActive = activePage === 'writing' ? ' class="active"' : '';
    const fractalActive = activePage === 'fractal' ? ' class="active"' : '';

    return `
    <header class="site-header">
        <nav class="nav-container">
            <ul class="nav-links">
                <li><a href="/"${homeActive}>home</a></li>
                <li><a href="/writing.html"${writingActive}>writing</a></li>
                <li><a href="/series/fractal.html"${fractalActive}>fractal</a></li>
            </ul>
        </nav>
    </header>`;
}

// Generate HTML for a single post
function generatePostHTML(post, seriesPosts = null, isFractal = false) {
    let seriesNav = '';

    if (isFractal && seriesPosts) {
        const currentIndex = seriesPosts.findIndex(p => p.slug === post.slug);
        const prevPost = currentIndex > 0 ? seriesPosts[currentIndex - 1] : null;
        const nextPost = currentIndex < seriesPosts.length - 1 ? seriesPosts[currentIndex + 1] : null;

        seriesNav = `
            <nav class="series-nav">
                <div class="series-info">
                    <a href="/series/fractal.html">Fractal</a>
                    <span class="series-progress">Part ${currentIndex} of ${seriesPosts.length}</span>
                </div>
                <div class="series-links">
                    ${prevPost ? `<a href="/posts/${prevPost.slug}.html" class="prev-post">← ${prevPost.title}</a>` : '<span></span>'}
                    ${nextPost ? `<a href="/posts/${nextPost.slug}.html" class="next-post">${nextPost.title} →</a>` : '<span></span>'}
                </div>
            </nav>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${post.title} - ${SITE_TITLE}</title>
    ${post.description ? `<meta name="description" content="${post.description}">` : ''}
    <link rel="stylesheet" href="../css/style.css">
</head>
<body>
    ${generateNav()}

    <main class="container">
        <article>
            <header class="post-header">
                <time class="post-date">${formatDate(post.date)}</time>
                <h1>${post.title}</h1>
            </header>

            ${seriesNav}

            <div class="post-content">
                ${post.html}
            </div>

            ${seriesNav}
        </article>
    </main>

    <footer class="site-footer">
        <div class="container">
            <p>&copy; ${new Date().getFullYear()} ${SITE_TITLE}. All rights reserved.</p>
        </div>
    </footer>

    <script src="../js/main.js"></script>
</body>
</html>`;
}

// Format project description with arrow styling
function formatProjectDescription(description) {
    if (!description) return '';

    const lines = description.split('\n');
    const formattedLines = lines.map(line => {
        // Lines starting with → get special styling
        if (line.startsWith('→')) {
            return `<p class="project-detail">${line}</p>`;
        }
        // Regular description line
        return `<p class="project-description">${line}</p>`;
    });

    return formattedLines.join('\n                    ');
}

// Generate homepage HTML
function generateIndexHTML(projects) {
    const projectCards = projects.map(project => {
        const imageContent = project.image
            ? `<img src="/images/${encodeURIComponent(project.image)}" alt="${project.title}">`
            : '';

        const imageHtml = project.image
            ? (project.url
                ? `<a href="${project.url}" target="_blank" rel="noopener" class="project-image">${imageContent}</a>`
                : `<div class="project-image">${imageContent}</div>`)
            : '';

        const descriptionHtml = formatProjectDescription(project.description);

        return `
            <article class="project-card">
                <h3 class="project-title">${project.url ? `<a href="${project.url}" target="_blank" rel="noopener">${project.title}</a>` : project.title}</h3>
                <div class="project-card-inner">
                    ${imageHtml}
                    <div class="project-content">
                        ${descriptionHtml}
                    </div>
                </div>
            </article>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${SITE_TITLE}</title>
    <meta name="description" content="${SITE_DESCRIPTION}">
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    ${generateNav('home')}

    <main class="container">
        <section class="hero">
            <div class="hero-photo">
                <img src="/images/profile.jpeg" alt="Frank">
            </div>
            <h1>hello, i'm frank.</h1>
            <p class="hero-subtitle">You can see some of my work below 👇</p>
            <p class="hero-bio">Hi there! My name is Frank, and I'm a software engineer! This site is a personal collection of reading, writing, and experiences inside and outside of engineering.</p>
        </section>

        ${projects.length > 0 ? `
        <section class="projects-section">
            <h2>Projects</h2>
            <div class="projects-grid">
${projectCards}
            </div>
        </section>
        ` : ''}
    </main>

    <footer class="site-footer">
        <div class="container">
            <p>&copy; ${new Date().getFullYear()} ${SITE_TITLE}. All rights reserved.</p>
        </div>
    </footer>

    <script src="js/main.js"></script>
</body>
</html>`;
}

// Generate writing page HTML (Fractal card + standalone articles)
function generateWritingHTML(articles, fractalPosts) {
    const articleCards = articles.map(post => `
            <article class="post-card">
                <h2 class="post-title"><a href="/posts/${post.slug}.html">${post.title}</a></h2>
                <p class="post-excerpt">${getExcerpt(post)}</p>
            </article>`).join('\n');

    const fractalCard = fractalPosts.length > 0 ? `
            <a href="/series/fractal.html" class="series-card">
                <div class="series-card-content">
                    <h2>Fractal Bootcamp</h2>
                    <p>A 90-day journey through a software engineering bootcamp in NYC.</p>
                    <span class="series-count">${fractalPosts.length} posts</span>
                </div>
                <span class="series-arrow">→</span>
            </a>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Writing - ${SITE_TITLE}</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    ${generateNav('writing')}

    <main class="container container-narrow">
        <section class="page-header">
            <h1>all writing</h1>
        </section>

        <section class="series-section">
${fractalCard}
        </section>

        <section class="posts">
${articleCards}
        </section>
    </main>

    <footer class="site-footer">
        <div class="container">
            <p>&copy; ${new Date().getFullYear()} ${SITE_TITLE}. All rights reserved.</p>
        </div>
    </footer>

    <script src="js/main.js"></script>
</body>
</html>`;
}

// Generate series index page HTML
function generateSeriesHTML(seriesName, posts) {
    const postList = posts.map((post, index) => `
                <li class="series-item">
                    <span class="series-item-number">${index}</span>
                    <a href="/posts/${post.slug}.html">${post.title}</a>
                    <time>${formatDate(post.date)}</time>
                </li>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${seriesName} - ${SITE_TITLE}</title>
    <link rel="stylesheet" href="../css/style.css">
</head>
<body>
    ${generateNav('fractal')}

    <main class="container">
        <section class="series-header">
            <h1>${seriesName}</h1>
            <p class="series-description">A 90-day journey through a software engineering bootcamp in NYC.</p>
            <p class="series-meta">${posts.length} posts</p>
        </section>

        <section class="series-list">
            <ol>
${postList}
            </ol>
        </section>
    </main>

    <footer class="site-footer">
        <div class="container">
            <p>&copy; ${new Date().getFullYear()} ${SITE_TITLE}. All rights reserved.</p>
        </div>
    </footer>

    <script src="../js/main.js"></script>
</body>
</html>`;
}

// Copy images to output folder
function copyImages() {
    if (imagesToCopy.size === 0) return;

    // Ensure images output directory exists
    if (!fs.existsSync(IMAGES_OUTPUT)) {
        fs.mkdirSync(IMAGES_OUTPUT, { recursive: true });
    }

    for (const { source, filename } of imagesToCopy) {
        const dest = path.join(IMAGES_OUTPUT, filename);
        fs.copyFileSync(source, dest);
        console.log(`  ✓ Copied: images/${filename}`);
    }
}

// Main build function
async function build() {
    console.log('Building blog...\n');
    console.log(`Blog root: ${BLOG_ROOT}`);
    console.log(`Vault root: ${VAULT_ROOT}\n`);

    // Ensure output directories exist
    if (!fs.existsSync(POSTS_OUTPUT)) {
        fs.mkdirSync(POSTS_OUTPUT, { recursive: true });
    }
    if (!fs.existsSync(SERIES_OUTPUT)) {
        fs.mkdirSync(SERIES_OUTPUT, { recursive: true });
    }

    // Read posts from each folder
    // Fractal requires numbered files, Main does not
    const fractalPosts = readPostsFromFolder(FRACTAL_SOURCE, true)
        .sort((a, b) => (a.postNumber ?? 0) - (b.postNumber ?? 0));

    const mainPosts = readPostsFromFolder(MAIN_SOURCE, false)
        .sort((a, b) => (b.date || 0) - (a.date || 0));

    const projects = readProjectsFromFolder(PROJECTS_SOURCE);

    console.log(`Found ${fractalPosts.length} Fractal post(s)`);
    console.log(`Found ${mainPosts.length} Main article(s)`);
    console.log(`Found ${projects.length} project(s)\n`);

    // Generate Fractal post pages
    for (const post of fractalPosts) {
        const postHTML = generatePostHTML(post, fractalPosts, true);
        const outputPath = path.join(POSTS_OUTPUT, `${post.slug}.html`);
        fs.writeFileSync(outputPath, postHTML);
        console.log(`  ✓ Generated: posts/${post.slug}.html (Fractal)`);
    }

    // Generate Main article pages
    for (const post of mainPosts) {
        const postHTML = generatePostHTML(post, null, false);
        const outputPath = path.join(POSTS_OUTPUT, `${post.slug}.html`);
        fs.writeFileSync(outputPath, postHTML);
        console.log(`  ✓ Generated: posts/${post.slug}.html (Main)`);
    }

    // Generate index page
    fs.writeFileSync(INDEX_PATH, generateIndexHTML(projects));
    console.log(`  ✓ Generated: index.html`);

    // Generate writing page
    fs.writeFileSync(WRITING_PATH, generateWritingHTML(mainPosts, fractalPosts));
    console.log(`  ✓ Generated: writing.html`);

    // Generate Fractal series page
    if (fractalPosts.length > 0) {
        const fractalPath = path.join(SERIES_OUTPUT, 'fractal.html');
        fs.writeFileSync(fractalPath, generateSeriesHTML('Fractal', fractalPosts));
        console.log(`  ✓ Generated: series/fractal.html`);
    }

    // Copy images
    if (imagesToCopy.size > 0) {
        console.log('');
        copyImages();
    }

    console.log(`\n✅ Build complete!`);
    console.log(`   ${fractalPosts.length} Fractal posts`);
    console.log(`   ${mainPosts.length} Main articles`);
    console.log(`   ${projects.length} projects`);
    console.log(`   ${imagesToCopy.size} images copied`);
}

build().catch(console.error);
