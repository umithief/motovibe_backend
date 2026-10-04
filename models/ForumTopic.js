import mongoose from 'mongoose';

const forumCommentSchema = new mongoose.Schema({
    _id: String,
    authorId: String,
    authorName: String,
    content: String,
    date: String,
    likes: { type: Number, default: 0 }
}, { versionKey: false });

const forumTopicSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    authorId: String,
    authorName: String,
    title: String,
    content: String,
    category: String,
    date: String,
    likes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    comments: [forumCommentSchema],
    tags: [String]
}, { versionKey: false });

const ForumTopic = mongoose.models.ForumTopic || mongoose.model('ForumTopic', forumTopicSchema);

export default ForumTopic;
