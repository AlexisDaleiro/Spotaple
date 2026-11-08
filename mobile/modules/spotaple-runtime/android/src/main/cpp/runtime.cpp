#include <jni.h>
#include <node.h>
#include <string>
#include <vector>

extern "C" JNIEXPORT jint JNICALL
Java_com_alexis_spotaple_runtime_NodeRuntime_startNode(JNIEnv* env, jobject, jobjectArray arguments) {
    const auto count = env->GetArrayLength(arguments);
    std::vector<std::string> strings;
    strings.reserve(count);
    for (jsize i = 0; i < count; i++) {
        const auto argument = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char* chars = env->GetStringUTFChars(argument, nullptr);
        if (!chars) return 1;
        strings.emplace_back(chars);
        env->ReleaseStringUTFChars(argument, chars);
        env->DeleteLocalRef(argument);
    }
    std::vector<char*> argv;
    argv.reserve(count + 1);
    for (auto& argument : strings) argv.push_back(&argument[0]);
    argv.push_back(nullptr);
    return node::Start(count, argv.data());
}
