const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { sql, poolPromise } = require('../db');
const { authMiddleware } = require('../middleware/auth');

function loadQuestions(ageGroup) {
    const file = ageGroup === 'preschool' ? 'questions-preschool.txt' : 'questions-school.txt';
    const filePath = path.join(__dirname, '..', file);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const questions = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split('|');
        if (parts.length === 3) questions.push({ id: parts[0].trim(), domain: parts[1].trim(), text: parts[2].trim() });
    }
    return questions;
}

function getAgeGroup(dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const now = new Date();
    const age = now.getFullYear() - dob.getFullYear() - (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
    if (age >= 3 && age <= 5) return { group: 'preschool', age, label: 'Preschool (Ages 3–5)' };
    if (age >= 6 && age <= 8) return { group: 'school', age, label: 'Early School Age (Ages 6–8)' };
    return null;
}

router.post('/initialize', authMiddleware, async (req, res) => {
    try {
        const { childId } = req.body;
        if (!childId) return res.status(400).json({ error: 'childId is required.' });
        const pool = await poolPromise;
        const childResult = await pool.request().input('childId', sql.Int, childId).query('SELECT * FROM children WHERE id = @childId');
        if (childResult.recordset.length === 0) return res.status(404).json({ error: 'Child not found.' });
        const child = childResult.recordset[0];
        const ageInfo = getAgeGroup(child.dateOfBirth);
        if (!ageInfo) return res.status(400).json({ error: 'Child must be between ages 3-8 for screening.' });
        const questions = loadQuestions(ageInfo.group);
        const result = await pool.request().input('childId', sql.Int, childId).input('createdBy', sql.Int, req.user.userId)
            .query("INSERT INTO assessments (childId,createdBy,status,currentProgress) OUTPUT INSERTED.id VALUES (@childId,@createdBy,'in_progress',0)");
        res.json({ success: true, assessmentId: result.recordset[0].id, ageGroup: ageInfo.group, ageLabel: ageInfo.label, childAge: ageInfo.age, questions, totalQuestions: questions.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/save-draft', authMiddleware, async (req, res) => {
    try {
        const { assessmentId, progress, answers } = req.body;
        const pool = await poolPromise;
        await pool.request().input('assessmentId', sql.Int, assessmentId).input('progress', sql.Int, progress || 0)
            .query('UPDATE assessments SET currentProgress=@progress WHERE id=@assessmentId');
        if (answers && answers.length > 0) {
            for (const a of answers) {
                await pool.request()
                    .input('assessmentId', sql.Int, assessmentId).input('questionId', sql.NVarChar, String(a.questionId))
                    .input('domain', sql.NVarChar, a.domain || '').input('questionText', sql.NVarChar, a.questionText || '').input('answer', sql.NVarChar, a.answer)
                    .query(`IF EXISTS (SELECT 1 FROM assessment_answers WHERE assessmentId=@assessmentId AND questionId=@questionId)
                                UPDATE assessment_answers SET answer=@answer WHERE assessmentId=@assessmentId AND questionId=@questionId
                            ELSE INSERT INTO assessment_answers (assessmentId,questionId,domain,questionText,answer) VALUES (@assessmentId,@questionId,@domain,@questionText,@answer)`);
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/submit', authMiddleware, async (req, res) => {
    try {
        const { assessmentId, childId, answers } = req.body;
        const pool = await poolPromise;
        if (answers && answers.length > 0) {
            for (const a of answers) {
                await pool.request()
                    .input('assessmentId', sql.Int, assessmentId).input('questionId', sql.NVarChar, String(a.questionId))
                    .input('domain', sql.NVarChar, a.domain || '').input('questionText', sql.NVarChar, a.questionText || '').input('answer', sql.NVarChar, a.answer)
                    .query(`IF EXISTS (SELECT 1 FROM assessment_answers WHERE assessmentId=@assessmentId AND questionId=@questionId)
                                UPDATE assessment_answers SET answer=@answer WHERE assessmentId=@assessmentId AND questionId=@questionId
                            ELSE INSERT INTO assessment_answers (assessmentId,questionId,domain,questionText,answer) VALUES (@assessmentId,@questionId,@domain,@questionText,@answer)`);
            }
        }
        const scoreResult = await pool.request().input('assessmentId', sql.Int, assessmentId)
            .query("SELECT domain, SUM(CASE WHEN answer='yes' THEN 2 WHEN answer='sometimes' THEN 1 ELSE 0 END) AS earned, COUNT(*)*2 AS total FROM assessment_answers WHERE assessmentId=@assessmentId GROUP BY domain");
        const scores = {};
        for (const row of scoreResult.recordset) scores[row.domain] = row.total > 0 ? Math.round((row.earned/row.total)*100) : 0;
        const comm=scores['Communication']||0, soc=scores['Social Skills']||0, cog=scores['Cognitive']||0, motor=scores['Motor Skills']||0;
        const overall = Math.round((comm+soc+cog+motor)/4);
        const getStatus = s => s>=70?'on-track':s>=40?'at-risk':'delayed';
        const riskFlags = [];
        if(comm<40) riskFlags.push('Communication delay detected');
        if(soc<40) riskFlags.push('Social skills concern detected');
        if(cog<40) riskFlags.push('Cognitive development concern');
        if(motor<40) riskFlags.push('Motor skills delay detected');
        const resInsert = await pool.request()
            .input('assessmentId',sql.Int,assessmentId).input('childId',sql.Int,childId)
            .input('communicationScore',sql.Float,comm).input('socialScore',sql.Float,soc)
            .input('cognitiveScore',sql.Float,cog).input('motorScore',sql.Float,motor).input('overallScore',sql.Float,overall)
            .input('communicationStatus',sql.NVarChar,getStatus(comm)).input('socialStatus',sql.NVarChar,getStatus(soc))
            .input('cognitiveStatus',sql.NVarChar,getStatus(cog)).input('motorStatus',sql.NVarChar,getStatus(motor))
            .input('riskFlags',sql.NVarChar,JSON.stringify(riskFlags))
            .query(`INSERT INTO assessment_results (assessmentId,childId,communicationScore,socialScore,cognitiveScore,motorScore,overallScore,communicationStatus,socialStatus,cognitiveStatus,motorStatus,riskFlags)
                    OUTPUT INSERTED.id VALUES (@assessmentId,@childId,@communicationScore,@socialScore,@cognitiveScore,@motorScore,@overallScore,@communicationStatus,@socialStatus,@cognitiveStatus,@motorStatus,@riskFlags)`);
        await pool.request().input('assessmentId',sql.Int,assessmentId).query("UPDATE assessments SET status='complete',completedAt=GETDATE() WHERE id=@assessmentId");
        res.json({ success: true, resultId: resInsert.recordset[0].id, assessmentId, analysisStatus: 'complete' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:assessmentId/results', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('assessmentId',sql.Int,req.params.assessmentId).query('SELECT * FROM assessment_results WHERE assessmentId=@assessmentId');
        if (result.recordset.length===0) return res.status(404).json({ error: 'Results not found.' });
        const r = result.recordset[0];
        r.riskFlags = JSON.parse(r.riskFlags||'[]');
        res.json({ success: true, results: r });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:childId/history', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('childId',sql.Int,req.params.childId).query('SELECT * FROM assessments WHERE childId=@childId ORDER BY startedAt DESC');
        res.json({ success: true, assessments: result.recordset });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
