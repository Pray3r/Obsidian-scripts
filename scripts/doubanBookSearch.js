/*
 *  
 *  Yet another douban book script by Pray3r 
 *  https://kernfunny.org
 *
 */
const notice = msg => new Notice(msg, 5000);

const headers = {
    "Content-Type": "text/html; charset=utf-8",
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.100.4758.11 Safari/537.36'
};


module.exports = fetchDoubanBook;

let QuickAdd;

async function fetchDoubanBook(params) {
    QuickAdd = params;

    try {
        const query = await QuickAdd.quickAddApi.inputPrompt("🔍请输入要搜索的图书名称或ISBN：");
        if (!query) return notice("没有输入任何内容"); 
      
        const searchResult = await searchBooksByTitle(query);
        if (!searchResult || searchResult.length === 0) return notice("找不到你搜索的内容");

        const selectedBook = await QuickAdd.quickAddApi.suggester(
            obj => obj.text,
            searchResult
        );
        if (!selectedBook) return notice("没有选择任何内容");

        const bookInfo = await parseBookFromUrl(selectedBook.link);

        QuickAdd.variables = { ...bookInfo };
        
    } catch (error) {
        console.error("Error in fetchDoubanBook:", error);
        notice("处理请求时发生错误");
    }
}

async function searchBooksByTitle(title) {
    const searchURL = `https://www.douban.com/search?cat=1001&q=${encodeURIComponent(title)}`;
    const doubanBaseURL = "https://book.douban.com/subject/";

    try {
        const response = await request({
            url: searchURL,
            method: "GET",
            cache: "no-cache",
            headers: headers,
            timeout: 5000
        });

        if (!response) return null;

        const document = new DOMParser().parseFromString(response, "text/html");
        const searchResults = Array.from(document.querySelectorAll(".result-list .result"));
      
        return searchResults.map(result => {
            const bookLinkElement = result.querySelector("h3 a");
            const bookIDMatch = bookLinkElement?.getAttribute('onclick')?.match(/\d+(?=,)/);

            if (!bookIDMatch) return null;

            const bookTitle = cleanTitle(bookLinkElement.textContent);
            const bookInfo = result.querySelector(".subject-cast")?.textContent.trim() || "信息不详";
            const bookRating = result.querySelector(".rating_nums")?.textContent || "暂无评分";
            const bookLink = `${doubanBaseURL}${bookIDMatch[0]}`;

            return {
                text: `📚 《${bookTitle}》 ${bookInfo} / ${bookRating}`,
                link: bookLink
            };
        }).filter(Boolean);
    } catch (error) {
        console.error("Failed to fetch book data:", error); 
        return null;
    }
}

async function parseBookFromUrl(url) {
    try {
        const response = await request({
            url: url,
            method: "GET",
            cache: "no-cache",
            headers: headers
        });

        if (!response) throw new Error('Failed to fetch page content.'); 

        const doc = new DOMParser().parseFromString(response, 'text/html');
        const $ = selector => doc.querySelector(selector);
        const $$ = selector => doc.querySelectorAll(selector);

        const infoSection = $('#info');
        const metaSection = $$('meta');
        const bookId = url.match(/\d+/g)?.[0] || '';

        const fields = {
            bookTitle: cleanTitle(extractContent(metaSection, 'og:title', 'content', 'Unknown Title')),
            subtitle: extractText(infoSection, /副标题:\s*([\S ]+)/),
            authors: formatAuthors(extractMultipleContent(metaSection, 'book:author')),
            isbn: extractContent(metaSection, 'book:isbn', 'content', ' '),
            coverUrl: extractContent(metaSection, 'og:image', 'content', ' '),
            publisher: extractText(infoSection, /出版社:\s*([^\n\r]+)/),
            originalTitle: extractText(infoSection, /原作名:\s*([^\n\r]+)/),
            translators: extractText(infoSection, /译者:\s*([^\n\r]+)/, '/'),
            publicationYear: extractText(infoSection, /出版年:\s*([^\n\r]+)/),
            pageCount: extractText(infoSection, /页数:\s*([^\n\r]+)/),
            rating: extractText($('#interest_sectl strong.rating_num'), /([\d.]+)/) || ' ',
            summary: extractText($('.related_info .indent .intro:not(.author-info)')) || ' ',
            authorIntro: extractAuthorIntro($$),
            quotes: extractQuotes($$),
            contents: extractText($(`#dir_${bookId}_full`), '<br>'),
            tags: extractTags(doc, $$),
            bookUrl: url
        };

        return cleanFields(fields);
    } catch (error) {
        console.error(`Failed to fetch or parse the URL: ${url}`, error); 
        return { message: 'Failed to parse the content due to an error.' };
    }
}


function extractContent(elements, property, attr = 'textContent', defaultValue = ' ') {
    const element = Array.from(elements).find(el => el.getAttribute('property') === property);
    return element?.[attr]?.trim() ?? defaultValue;
}

function extractMultipleContent(elements, property) {
    return Array.from(elements)
        .filter(el => el.getAttribute('property') === property)
        .map(el => el.content.trim());
}

function extractText(element, regex = null, split = '') {
    if (!element) return ' ';
    let value = element.textContent.trim();
    if (regex) {
        const match = value.match(regex);
        value = match ? match[1].trim() : ' ';
    }
    return split && value ? value.split(split).map(item => item.trim()) : value;
}

function cleanTitle(title) {
    return title.replace(/[\/\\:]/g, '，').replace(/["]/g, ' ');
}

function formatAuthors(authors) {
    return authors.length ? `"${authors.join(', ')}"` : ' ';
}

function extractAuthorIntro($$) {
    const authorIntroHeader = Array.from($$("h2")).find(h2 => h2.textContent.includes("作者简介"));
    if (authorIntroHeader) {
        const intros = authorIntroHeader.nextElementSibling?.querySelectorAll("div.intro p");
        return intros ? Array.from(intros).map(p => p.textContent.trim()).join("\n") : ' ';
    }
    return ' ';
}

function extractQuotes($$) {
    return Array.from($$("figure")).map(figure => {
        const quote = figure.childNodes[0]?.textContent.replace(/\(/g, "").trim() || ' ';
        const source = figure.querySelector("figcaption")?.textContent.replace(/\s/g, "") || ' ';
        return quote || source ? `${quote}\n${source}`.trim() : null;
    }).filter(Boolean);
}

function extractTags(doc, $$) {
    const scriptContent = $$("script")[doc.scripts.length - 3]?.textContent;
    const tags = scriptContent?.match(/(?<=:)[\u4e00-\u9fa5·]+/g);
    return tags ? tags.join(', ') : ' ';
}

function cleanFields(fields) {
    return Object.keys(fields).reduce((acc, key) => {
        acc[key] = fields[key] ?? ' ';
        return acc;
    }, {});
}
