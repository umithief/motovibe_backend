import re
file_path = r'routes\analyticsRoutes.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add SLIDE_EVENT_TYPES
slide_event_types = '''const SLIDE_EVENT_TYPES = new Set([
    'slide_view',
    'slide_click',
]);

const FEED_EVENT_TYPES = new Set(['''

content = content.replace("const FEED_EVENT_TYPES = new Set([", slide_event_types)

# Update POST /api/analytics/event
new_post_logic = '''// POST /api/analytics/event
router.post('/event', protectFeedAnalytics, async (req, res) => {
    try {
        const eventData = req.body || {};

        if (typeof eventData.type !== 'string' || !eventData.type.trim()) {
            return res.status(400).json({ message: 'Event type required' });
        }

        const eventType = eventData.type.trim();

        if (eventType.startsWith('feed_') && !FEED_EVENT_TYPES.has(eventType)) {
            return res.status(400).json({ message: 'Unsupported feed event' });
        }
        
        if (eventType.startsWith('slide_') && !SLIDE_EVENT_TYPES.has(eventType)) {
            return res.status(400).json({ message: 'Unsupported slide event' });
        }

        const isFeedEvent = FEED_EVENT_TYPES.has(eventType);
        const isSlideEvent = SLIDE_EVENT_TYPES.has(eventType);
        
        let cleanEvent = eventData;
        if (isFeedEvent) {
             cleanEvent = {
                type: eventType,
                postId: String(eventData.postId || '').slice(0, 80),
                contentType: ['post', 'reel', 'route', 'ad'].includes(eventData.contentType)
                    ? eventData.contentType
                    : 'post',
                source: String(eventData.source || 'unknown').slice(0, 32),
                isSponsored: eventData.isSponsored === true,
                ...(eventType === 'feed_dwell' ? {
                    durationMs: Math.min(
                        Math.max(Number(eventData.durationMs) || 0, 0),
                        30 * 60 * 1000
                    )
                } : {})
            };
            if (!cleanEvent.postId) {
                return res.status(400).json({ message: 'Post id required' });
            }
        } else if (isSlideEvent) {
             cleanEvent = {
                 type: eventType,
                 slideId: String(eventData.slideId || '').slice(0, 80),
                 title: String(eventData.title || '').slice(0, 100),
                 actionType: String(eventData.actionType || '').slice(0, 50),
                 actionTarget: String(eventData.actionTarget || '').slice(0, 200),
                 index: Number(eventData.index) || 0,
             };
        }

        const newEvent = new Analytics({
            ...cleanEvent,
            timestamp: Date.now(),
            date: new Date().toLocaleDateString('tr-TR')
        });

        await newEvent.save();
        res.status(201).json({ message: 'Event tracked' });
    } catch (error) {
        console.error('Event error:', error);
        res.status(500).json({ message: error.message });
    }
});'''

pattern = re.compile(r'// POST /api/analytics/event\nrouter\.post\(\'/event\', protectFeedAnalytics, async \(req, res\) => \{.*?\n\}\);\n', re.DOTALL)
content = pattern.sub(new_post_logic + '\n', content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated analyticsRoutes.js")
