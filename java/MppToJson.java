import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.mpxj.ProjectFile;
import org.mpxj.Relation;
import org.mpxj.Resource;
import org.mpxj.ResourceAssignment;
import org.mpxj.Task;
import org.mpxj.TimeUnit;
import org.mpxj.reader.UniversalProjectReader;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Reads a .mpp (or anything else UniversalProjectReader supports) and prints one JSON object to
 * stdout: the tasks that look like real LOQs (jira-key-shaped Text3), their resource assignments,
 * and the resource roster. See docs/INTEGRATIONS.md for why these specific custom fields are used
 * (Text1=discipline, Text2=LOQ type, Text3=Jira key, parent task name=Cinematic) — this mapping
 * was confirmed empirically against a real production file, not guessed from the format spec.
 *
 * Usage: java -cp <shim-dir>;<lib-dir>/* MppToJson <path-to-project-file>
 * On success: JSON on stdout, exit 0. On failure: message on stderr, exit 1.
 */
public class MppToJson {
    private static final Pattern JIRA_KEY = Pattern.compile("^[A-Z]+-\\d+$");
    private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    public static void main(String[] args) {
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        PrintStream err = new PrintStream(System.err, true, StandardCharsets.UTF_8);
        if (args.length < 1) {
            err.println("usage: MppToJson <path-to-project-file>");
            System.exit(1);
            return;
        }
        try {
            ObjectMapper mapper = new ObjectMapper();
            ObjectNode root = mapper.createObjectNode();
            ProjectFile project = new UniversalProjectReader().read(args[0]);

            // Task-uid -> resource assignments (project-level list; per-task getResource() is
            // unreliable — see docs/INTEGRATIONS.md).
            Map<Integer, List<ResourceAssignment>> assignmentsByTask = new HashMap<>();
            for (ResourceAssignment a : project.getResourceAssignments()) {
                Task t = a.getTask();
                if (t == null) continue;
                assignmentsByTask.computeIfAbsent(t.getUniqueID(), k -> new ArrayList<>()).add(a);
            }

            ArrayNode tasksNode = mapper.createArrayNode();
            Map<Integer, Boolean> includedTaskUids = new HashMap<>();
            int nonSummaryTaskCount = 0;

            for (Task t : project.getTasks()) {
                if (t.getName() == null || Boolean.TRUE.equals(t.getSummary())) continue;
                nonSummaryTaskCount++;
                String jiraKey = trimOrNull(t.getText(3));
                boolean included = jiraKey != null && JIRA_KEY.matcher(jiraKey).matches();
                includedTaskUids.put(t.getUniqueID(), included);
                if (!included) continue;

                ObjectNode taskNode = mapper.createObjectNode();
                taskNode.put("uid", t.getUniqueID());
                taskNode.put("name", t.getName());
                Task parent = t.getParentTask();
                taskNode.put("cinematicName", parent != null ? parent.getName() : null);
                taskNode.put("discipline", trimOrNull(t.getText(1)));
                taskNode.put("loqType", trimOrNull(t.getText(2)));
                taskNode.put("jiraKey", jiraKey);
                taskNode.put("start", isoDate(t.getStart()));
                taskNode.put("finish", isoDate(t.getFinish()));
                taskNode.put("durationDays", durationInDays(t));
                taskNode.put("workHours", workInHours(t));

                ArrayNode predsNode = mapper.createArrayNode();
                if (t.getPredecessors() != null) {
                    for (Relation r : t.getPredecessors()) {
                        Task pt = r.getPredecessorTask();
                        if (pt == null) continue;
                        ObjectNode predNode = mapper.createObjectNode();
                        predNode.put("uid", pt.getUniqueID());
                        predNode.put("type", r.getType() != null ? r.getType().toString() : "FS");
                        predNode.put("lagDays", lagInDays(r));
                        predsNode.add(predNode);
                    }
                }
                taskNode.set("predecessors", predsNode);

                ArrayNode resourcesNode = mapper.createArrayNode();
                for (ResourceAssignment a : assignmentsByTask.getOrDefault(t.getUniqueID(), List.of())) {
                    Resource r = resolveResource(project, a);
                    if (r == null || r.getName() == null) continue;
                    ObjectNode resNode = mapper.createObjectNode();
                    resNode.put("name", r.getName());
                    resNode.put("group", trimOrNull(r.getGroup()));
                    resNode.put("start", isoDate(a.getStart()));
                    resNode.put("finish", isoDate(a.getFinish()));
                    resNode.put("units", a.getUnits() != null ? a.getUnits().doubleValue() : 100.0);
                    resourcesNode.add(resNode);
                }
                taskNode.set("resources", resourcesNode);

                tasksNode.add(taskNode);
            }
            root.put("totalNonSummaryTasks", nonSummaryTaskCount);
            root.set("tasks", tasksNode);

            // Roster of every distinct named resource actually assigned to an included task, for
            // people-creation metadata (name + discipline hint from their group).
            LinkedHashSet<Integer> rosterUids = new LinkedHashSet<>();
            for (Task t : project.getTasks()) {
                if (!Boolean.TRUE.equals(includedTaskUids.get(t.getUniqueID()))) continue;
                for (ResourceAssignment a : assignmentsByTask.getOrDefault(t.getUniqueID(), List.of())) {
                    Integer ruid = a.getResourceUniqueID();
                    if (ruid != null) rosterUids.add(ruid);
                }
            }
            ArrayNode rosterNode = mapper.createArrayNode();
            for (Integer ruid : rosterUids) {
                Resource r = project.getResourceByUniqueID(ruid);
                if (r == null || r.getName() == null) continue;
                ObjectNode resNode = mapper.createObjectNode();
                resNode.put("name", r.getName());
                resNode.put("group", trimOrNull(r.getGroup()));
                rosterNode.add(resNode);
            }
            root.set("resourceRoster", rosterNode);

            out.println(mapper.writeValueAsString(root));
        } catch (Exception e) {
            err.println("MppToJson failed: " + e.getMessage());
            e.printStackTrace(err);
            System.exit(1);
        }
    }

    /** project-level getResourceAssignments() loses resolution via a.getResource() for some files
     * (see docs/INTEGRATIONS.md) — resolve explicitly by unique ID instead. */
    private static Resource resolveResource(ProjectFile project, ResourceAssignment a) {
        Integer uid = a.getResourceUniqueID();
        return uid != null ? project.getResourceByUniqueID(uid) : a.getResource();
    }

    private static String trimOrNull(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String isoDate(LocalDateTime dt) {
        return dt != null ? dt.format(ISO_DATE) : null;
    }

    private static Double durationInDays(Task t) {
        if (t.getDuration() == null) return null;
        return t.getDuration().convertUnits(TimeUnit.DAYS, t.getEffectiveCalendar()).getDuration();
    }

    private static Double workInHours(Task t) {
        if (t.getWork() == null) return null;
        return t.getWork().convertUnits(TimeUnit.HOURS, t.getEffectiveCalendar()).getDuration();
    }

    private static int lagInDays(Relation r) {
        if (r.getLag() == null) return 0;
        return (int) Math.round(r.getLag().convertUnits(TimeUnit.DAYS, null).getDuration());
    }
}
